// 카톡 이식 공통 — 원본 로딩, 사람 매핑, 멱등성 키.
import { createHash } from "crypto"
import { readFileSync } from "fs"
import { PrismaClient } from "../generated/prisma"

export const prisma = new PrismaClient()

/** 원본 데이터 위치. 저장소에 넣지 않으므로 환경변수로 받는다. */
export const DATA_DIR = process.env.KAKAO_DATA_DIR ?? `${process.env.HOME}/work/omnis-import`
const DATA = DATA_DIR

export interface RawMessage { t: string; u: string; m: string }
export interface RawSession { id: string; room: string; start: string; end: string; n: number; msgs: RawMessage[] }
export interface Classified {
  id: string; label: string; topic: string; project: string
  actionable?: boolean; uncertain?: boolean
}

export const loadSessions = (): RawSession[] =>
  JSON.parse(readFileSync(`${DATA}/sessions.json`, "utf8"))
export const loadClassified = (): Map<string, Classified> =>
  new Map(
    (JSON.parse(readFileSync(`${DATA}/final.json`, "utf8")) as Classified[]).map((c) => [c.id, c]),
  )

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
 * "윤훈 상무님" 은 1:1 대화라 제외한다 — ChatRoom 에 멤버십·접근 통제가 없어서
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

export const taskSourceId = (sessionId: string) => `kakao-session:${sessionId}`

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
