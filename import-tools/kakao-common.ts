// 카톡 이식 공통 — 원본 로딩, 세션 분할, 사람 매핑, 멱등성 키, Claude 호출.
import { createHash } from "crypto"
import { execFile } from "child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { basename, dirname } from "path"
import { PrismaClient } from "../generated/prisma"

export const prisma = new PrismaClient()

/** 원본 데이터 위치. 저장소에 넣지 않으므로 환경변수로 받는다. */
export const DATA_DIR = process.env.KAKAO_DATA_DIR ?? `${process.env.HOME}/work/omnis-import`

export interface RawMessage { t: string; u: string; m: string }
export interface RawRow extends RawMessage { room: string }
export interface RawSession { id: string; room: string; start: string; end: string; n: number; msgs: RawMessage[] }
export interface Classified {
  id: string; label: string; topic: string; project: string | null
  actionable?: boolean; uncertain?: boolean
  /** 분류 당시 메시지 수. 뒤에 세션이 길어지면 다시 분류할지 판단하는 근거다. */
  messages?: number
  classifiedAt?: string
}

// ─── 파일 입출력 ───────────────────────────────────────────

export function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback
}
export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 1))
}

export const loadSessions = (): RawSession[] => readJson<RawSession[]>(`${DATA_DIR}/sessions.json`, [])
export const loadClassified = (): Map<string, Classified> =>
  new Map(readJson<Classified[]>(`${DATA_DIR}/final.json`, []).map((c) => [c.id, c]))
export const saveClassified = (m: Map<string, Classified>): void =>
  writeJson(`${DATA_DIR}/final.json`, [...m.values()])

// ─── 카톡 CSV ─────────────────────────────────────────────

/**
 * "KakaoTalk_Chat_<방이름>_<YYYY-MM-DD-HH-MM-SS>.csv" 에서 방 이름을 꺼낸다.
 * 방 이름 자체에 밑줄이 있을 수 있어 앞뒤 고정 부분만 벗긴다.
 */
export function roomFromFilename(path: string): string {
  const name = basename(path).replace(/\.csv$/i, "")
  const m = name.match(/^KakaoTalk_Chat_(.+)_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/)
  if (!m) throw new Error(`카톡 내보내기 파일명이 아니다: ${basename(path)}`)
  return m[1]
}

/** RFC 4180 — 따옴표 안의 줄바꿈·이중따옴표를 처리한다. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ",") { row.push(cell); cell = "" }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = "" }
    else cell += ch
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

/**
 * 카톡 CSV 한 파일을 메시지 배열로.
 *
 * 처음 이식 때 파이썬 csv 모듈로 읽은 결과와 **바이트 단위로 같아야** 한다 —
 * 본문이 멱등성 키(sha1)에 들어가므로 줄바꿈 하나만 달라도 같은 메시지를 다시 넣는다.
 * 그래서 파이썬의 universal newline 처럼 \r\n·\r 을 \n 으로 접고, Date 가 빈 행은
 * 앞 메시지의 이어지는 줄로 붙인다.
 */
export function parseKakaoCsv(path: string): RawRow[] {
  const room = roomFromFilename(path)
  const text = readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const rows = parseCsv(text)
  const header = rows.shift()
  if (!header || header[0] !== "Date" || header[1] !== "User" || header[2] !== "Message") {
    throw new Error(`카톡 CSV 머리글이 아니다 (${header?.join(",")}): ${basename(path)}`)
  }
  const out: RawRow[] = []
  for (const r of rows) {
    if (r.length < 3) continue
    const [date, user, message] = r
    if (!date.trim()) {
      if (out.length > 0) out[out.length - 1].m += "\n" + message
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) continue
    out.push({ room, t: date, u: user, m: message })
  }
  return out
}

export const rowKey = (r: RawRow) => `${r.room}|${r.t}|${r.u}|${r.m}`

/** 원본 메시지 마스터. 지금까지 받은 모든 CSV 의 합집합이다. */
const RAW_PATH = `${DATA_DIR}/raw/messages.json`

export function loadRawMessages(): RawRow[] {
  if (existsSync(RAW_PATH)) return readJson<RawRow[]>(RAW_PATH, [])
  // 마스터가 없으면 처음 이식 때의 sessions.json 에서 되살린다.
  const rows: RawRow[] = []
  for (const s of loadSessions()) for (const m of s.msgs) rows.push({ room: s.room, ...m })
  return rows
}

/** 새 CSV 를 마스터에 합친다. 이미 있는 메시지는 건너뛴다. */
export function mergeRawMessages(incoming: RawRow[]): { all: RawRow[]; added: number } {
  const all = loadRawMessages()
  const seen = new Set(all.map(rowKey))
  let added = 0
  for (const r of incoming) {
    const k = rowKey(r)
    if (seen.has(k)) continue
    seen.add(k); all.push(r); added++
  }
  all.sort((a, b) => (a.room === b.room ? a.t.localeCompare(b.t) : a.room.localeCompare(b.room)))
  writeJson(RAW_PATH, all)
  return { all, added }
}

/** 한 시간 넘게 조용하면 세션이 끊긴 것으로 본다 (처음 분석 때 정한 기준). */
const SESSION_GAP_MS = 60 * 60 * 1000

/**
 * 메시지를 세션으로 자른다. 세션 id 는 방 + 첫 메시지 시각의 해시라,
 * 같은 세션이 새 CSV 에서 더 길어져도 id 는 그대로다.
 */
export function sessionize(rows: RawRow[]): RawSession[] {
  const sorted = [...rows].sort((a, b) => (a.room === b.room ? a.t.localeCompare(b.t) : a.room.localeCompare(b.room)))
  const groups: RawRow[][] = []
  let cur: RawRow[] = []
  for (const r of sorted) {
    const last = cur[cur.length - 1]
    if (last && last.room === r.room && parseKst(r.t).getTime() - parseKst(last.t).getTime() <= SESSION_GAP_MS) cur.push(r)
    else { if (cur.length) groups.push(cur); cur = [r] }
  }
  if (cur.length) groups.push(cur)
  return groups.map((g) => ({
    id: createHash("sha256").update(`${g[0].room}|${g[0].t.replace(" ", "T")}`).digest("hex").slice(0, 12),
    room: g[0].room,
    start: g[0].t,
    end: g[g.length - 1].t,
    n: g.length,
    msgs: g.map(({ t, u, m }) => ({ t, u, m })),
  }))
}

export function saveSessions(sessions: RawSession[]): void {
  writeJson(`${DATA_DIR}/sessions.json`, sessions)
}

// ─── 사람·방 ──────────────────────────────────────────────

/**
 * 카톡 표시명 → 옴니스 계정 이름.
 * 값이 null 이면 이식 대상이 아니다(현재는 없음 — 전원 매핑됨).
 */
export const SPEAKER_TO_USER: Record<string, string> = {
  "김아리 박사님": "김아리",
  "허채정 하드사이언스 대표님": "허채정",
  "정우창": "정우창",
  "노혜린 하드사이언스 과장님": "노혜린",
  "박소정": "박소정",
  "주용석(데과21)": "주용석",
  "Yuhooi": "윤훈",
  "주진호": "주진호",
}

/**
 * 이식할 방.
 *
 * 1:1 대화("윤훈 상무님" 등)는 제외한다 — ChatRoom 에 멤버십·접근 통제가 없어서
 * (roomId 만 알면 누구나 읽는다) 넣는 순간 사적인 대화가 전 구성원에게 공개된다.
 */
export const ROOMS: Record<string, { id: string; name: string }> = {
  // 두 방을 한 방으로 합친다(사용자 결정 2026-09-04).
  // 같은 사람들이 두 방을 오가며 일했으므로 시간순 한 흐름으로 읽는 편이 맞다.
  // id 가 default-room 인 것은 채팅 독이 그 방을 열기 때문이다.
  "하드사이언스 인턴방": { id: "default-room", name: "하드사이언스" },
  "HADD-수원대": { id: "default-room", name: "하드사이언스" },
}

/** 지시자·수행자 구분. 담당자 추정에 쓴다. */
export const WORKERS = new Set(["정우창", "박소정", "주용석(데과21)", "주진호", "Yuhooi"])

/**
 * 메시지 멱등성 키.
 * 같은 사람이 같은 시각에 같은 말을 두 번 할 수는 없으므로 이 조합이면 충분하다.
 */
export function messageSourceId(room: string, m: RawMessage): string {
  const h = createHash("sha1").update(`${room}|${m.t}|${m.u}|${m.m}`).digest("hex")
  return `kakao:${h}`
}

export const taskSourceId = (sessionId: string) => `kakao-task:${sessionId}`

/** 카톡 시각 문자열("2025-08-20 10:04:32")을 KST 로 해석한다. */
export function parseKst(t: string): Date {
  return new Date(`${t.replace(" ", "T")}+09:00`)
}

/** 이름 → User.id. 매핑에 없는 사람이 있으면 즉시 실패한다(조용한 유실 방지). */
export async function resolveUsers(): Promise<Map<string, string>> {
  const names = [...new Set(Object.values(SPEAKER_TO_USER))]
  const users = await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })
  const byName = new Map(users.map((u) => [u.name, u.id]))
  const missing = names.filter((n) => !byName.has(n))
  if (missing.length > 0) {
    throw new Error(`옴니스에 없는 계정: ${missing.join(", ")} — 먼저 create-past-members.ts 를 돌리세요`)
  }
  const bySpeaker = new Map<string, string>()
  for (const [speaker, name] of Object.entries(SPEAKER_TO_USER)) bySpeaker.set(speaker, byName.get(name)!)
  return bySpeaker
}

/**
 * 프로젝트 이름 정규화.
 *
 * 같은 프로젝트를 사람마다 다르게 적는다("AI 과제" / "AI과제" / "ai 과제").
 * 공백을 하나로 접고 소문자로 낮춰 비교한다.
 */
export function normalizeProjectName(input: string): string {
  return input.trim().replace(/\s+/g, " ").toLowerCase()
}

// ─── Claude 호출 ──────────────────────────────────────────

/**
 * `claude -p` 로 프롬프트 하나를 보내고 결과 텍스트를 받는다.
 *
 * Gemini 가 아니라 Claude 인 이유: 앱의 Gemini 는 무료 티어라 하루 500호출 안에서
 * 실서비스가 써야 한다. 이식은 한 번에 수백 세션을 읽히므로 그 예산을 건드리지 않는다.
 * 처음 633세션도 같은 방식(Claude 서브에이전트)으로 했다.
 */
export function askClaude(prompt: string, opts: { model: string; timeoutMs?: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    // 이 CLI 를 Claude Code 안에서 돌리면 CLAUDECODE 가 물려받아 중첩 실행을 막는다.
    delete env.CLAUDECODE
    const child = execFile(
      "claude",
      ["-p", "--output-format", "json", "--model", opts.model],
      { env, maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 15 * 60 * 1000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`claude 실패: ${err.message}\n${stderr}`))
        try {
          const out = JSON.parse(stdout) as { result?: string; is_error?: boolean }
          if (out.is_error) return reject(new Error(`claude 오류 응답: ${out.result}`))
          resolve(out.result ?? "")
        } catch {
          reject(new Error(`claude 출력이 JSON 이 아니다: ${stdout.slice(0, 300)}`))
        }
      },
    )
    child.stdin?.end(prompt)
  })
}

/** 모델이 코드블록으로 감싸 보내도 배열만 꺼낸다. */
export function parseJsonArray<T>(text: string): T[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  const start = cleaned.indexOf("["), end = cleaned.lastIndexOf("]")
  if (start < 0 || end < start) throw new Error(`JSON 배열을 찾지 못했다: ${cleaned.slice(0, 200)}`)
  const v = JSON.parse(cleaned.slice(start, end + 1))
  if (!Array.isArray(v)) throw new Error("배열이 아니다")
  return v as T[]
}

/** 여러 작업을 동시에 최대 n 개까지만 돌린다. */
export async function runParallel<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        results[i] = await fn(items[i], i)
      }
    }),
  )
  return results
}

export const pad2 = (n: number) => String(n).padStart(2, "0")
