/**
 * 회사 Context 이식 — 노션 · 엑셀 · 결산서를 새 모델로 옮긴다. 원본은 이제 옴니스다.
 *
 *   npx tsx scripts/import-company-context.ts                       # dry-run: 무엇이 들어갈지와 대조표만
 *   npx tsx scripts/import-company-context.ts --apply               # 실제로 쓴다 (서명은 NAS 에 올린다)
 *   npx tsx scripts/import-company-context.ts --only records,staff  # 일부만
 *
 * 입력은 저장소 밖 `~/work/omnis-import` (개인정보가 있어 저장소에 두지 않는다).
 *   notion/rows.json · notion/child_databases.json · notion/signatures/ · notion/corrections.json
 *   notion/statements/*.pdf  (표준재무제표 — 로컬 pdftotext 로 읽는다)
 *   records/support-awards-exhibitions_260827.xlsx · records/history_260316.xlsx
 *   notion/invoices/*.pdf  (홈택스 세금계산서 — 글자 PDF 는 좌표로, 이미지 PDF 는 --vision 으로 Gemini 판독)
 *
 * 멱등이다. 연혁은 dedupeKey, 인력·시장기업은 이름, 연도는 (연도, 단계) 로 upsert.
 * 설계와 결정: mydocs/plans/2026-09-14-company-context.md
 */
import "dotenv/config"
import { readFileSync, existsSync, readdirSync } from "fs"
import { execFileSync } from "child_process"
import { createHash } from "crypto"
import { homedir } from "os"
import { join } from "path"
import * as XLSXModule from "xlsx"
import type { WorkBook } from "xlsx"
import { prisma } from "@/lib/db"
import type { Prisma, RecordKind } from "@/generated/prisma/client"
import { putObject } from "@/lib/storage"
import { readInvoice, type ParsedInvoice } from "@/lib/tax-invoice"
import { matchOrg, matchQuote, quotesElsewhere } from "@/lib/crm-invoice-match"
import { planInvoice, saveInvoice } from "@/lib/tax-invoice-save"

// tsx 로 돌리면 CommonJS 인 xlsx 가 default 한 겹에 싸여 온다
const XLSX = ((XLSXModule as unknown as { default?: typeof XLSXModule }).default ?? XLSXModule) as typeof XLSXModule

const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const only = (() => {
  const i = args.indexOf("--only")
  return i >= 0 ? new Set(args[i + 1].split(",")) : null
})()
const want = (part: string) => !only || only.has(part)

const IMPORT_DIR = process.env.OMNIS_IMPORT_DIR ?? join(homedir(), "work/omnis-import")
const NOTION = join(IMPORT_DIR, "notion")
const RECORDS = join(IMPORT_DIR, "records")
const OUR_BIZ_NO = "503-52-46329"

// ─── 공통 ───────────────────────────────────────────────────────

/** BOM · non-breaking space · 겹친 공백을 걷어낸다 (엑셀에 섞여 있었다) */
const clean = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/﻿/g, "").replace(/ /g, " ").replace(/\s+/g, " ").trim()
  return s === "" ? null : s
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s()［\[\]（）『』「」·.,\-—~㈜]/g, "").toLowerCase()
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d))
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—")
const won = (n: bigint | number | null | undefined) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("ko-KR"))
const thousand = (v: unknown): bigint | null => {
  const s = clean(v)
  if (s === null) return null
  const n = Number(s.replace(/,/g, ""))
  return Number.isFinite(n) ? BigInt(Math.round(n * 1000)) : null
}

/**
 * 기간 원문 → 시작 · 끝. 엑셀에 20종의 표기가 섞여 있다.
 *   "2024. 03. ~ 2024. 12. " · "2026. 04. 28 ~ 2026. 04. 30" · "2024. 10.23 ~ 10. 24" · "2026.08. ~ 2026. 11. 30" · "2025.07.04" · "2026.09."
 * 날이 없으면 시작은 1일, 끝은 그 달 말일.
 */
export function parsePeriod(raw: string | null): { startsOn: Date | null; endsOn: Date | null; ok: boolean } {
  if (!raw) return { startsOn: null, endsOn: null, ok: false }
  const s = raw.replace(/\s+/g, " ").trim()
  const m = s.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.?\s*(\d{1,2})?\s*\.?\s*(?:~\s*(?:(\d{4})\s*\.\s*)?(\d{1,2})\s*\.?\s*(\d{1,2})?)?/)
  if (!m) return { startsOn: null, endsOn: null, ok: false }
  const [, y1, m1, d1, y2, m2, d2] = m
  const sy = Number(y1), sm = Number(m1)
  if (sm < 1 || sm > 12) return { startsOn: null, endsOn: null, ok: false }
  const startsOn = ymd(sy, sm, d1 ? Number(d1) : 1)
  let endsOn: Date | null = null
  if (m2) {
    const ey = y2 ? Number(y2) : sy
    const em = Number(m2)
    if (em >= 1 && em <= 12) endsOn = ymd(ey, em, d2 ? Number(d2) : lastDay(ey, em))
  } else if (!s.includes("~")) {
    endsOn = d1 ? startsOn : ymd(sy, sm, lastDay(sy, sm))
  }
  return { startsOn, endsOn, ok: true }
}

const tokens = (s: string) =>
  new Set(
    (s.match(/[가-힣A-Za-z0-9]+/g) ?? [])
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d{2,4}$/.test(t))
  )
const STOP = new Set([
  "부스", "운영", "참가", "참석", "선정", "사업", "지원", "지원사업", "프로그램", "모집", "하드사이언스", "주식회사", "수상", "입상", "행사", "방문", "발표",
  // 여러 행사에 두루 붙는 낱말 — 이것 하나로 붙이면 「G-SUMMIT」 이 「도전 K-스타트업」 에 붙는다(2026-09-14 dry-run)
  "스타트업", "과제", "창업", "협약", "입주", "신청", "추진", "박람회", "학술대회", "전시관", "공동", "경진대회", "bio", "korea",
])


/** 두 제목이 같은 사실인가. 공통 낱말 2개 이상, 또는 흔하지 않은 긴 낱말(4자+) 하나로 작은 쪽의 절반 이상 */
function matchScore(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((t) => b.has(t))
  if (shared.length === 0) return 0
  const ratio = shared.length / Math.min(a.size, b.size)
  if (shared.length >= 2 && ratio >= 0.5) return shared.length + ratio
  if (shared.length === 1 && shared[0].length >= 4 && ratio >= 0.5) return ratio
  return 0
}

function readXlsx(file: string) {
  if (!existsSync(file)) throw new Error(`입력 파일이 없습니다: ${file}`)
  return XLSX.readFile(file, { cellDates: false })
}
const rows = (wb: WorkBook, sheet: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: null })

// ─── 연혁 · 지원사업 · 수상 · 학회 ─────────────────────────────────────

interface RecordDraft {
  kind: RecordKind
  title: string
  organizer: string | null
  periodRaw: string | null
  startsOn: Date | null
  endsOn: Date | null
  status: string | null
  note: string | null
  subject?: string | null
  role?: string | null
  fundingKrw?: bigint | null
  ownCashKrw?: bigint | null
  ownInKindKrw?: bigint | null
  grantNo?: string | null
  prize?: string | null
  venue?: string | null
  partner?: string | null
  category?: string | null
  source: string
  projectName?: string
}

const dedupeKey = (r: RecordDraft) =>
  createHash("sha1")
    .update([r.kind, norm(r.title), norm(r.partner ?? r.organizer), r.startsOn ? iso(r.startsOn) : norm(r.periodRaw)].join("|"))
    .digest("hex")

/** 지원사업 → 이미 업무가 달린 프로젝트 (2026-09-10 대조, 오탐 3건 제외) */
const GRANT_PROJECT: [RegExp, string][] = [
  [/차세대 유망 Seed/i, "2025 Seed 과제(25.4-29.3)"],
  [/바이오아이코어/, "26 바이오아이코어사업"],
  [/AI 기반 바이오 소재 융복합/, "2026년 AI 기반 바이오 소재 융복합 제품의 적용·검증 및 시장진출 사업"],
  [/창업성장기술개발사업 디딤돌 첫걸음/, "2025년도 창업성장기술개발사업, 디딤돌 첫걸음 지방청 R&D(25.07-26.12)"],
]

function loadSheetRecords() {
  const wb = readXlsx(join(RECORDS, "support-awards-exhibitions_260827.xlsx"))
  const out: RecordDraft[] = []
  const unparsed: string[] = []

  // 지원사업 — 순번이 비어 있는 마지막 합계행은 건너뛴다
  for (const r of rows(wb, "지원사업").slice(1)) {
    if (clean(r[0]) === null || clean(r[1]) === null) continue
    const periodRaw = clean(r[4])
    const p = parsePeriod(periodRaw)
    if (periodRaw && !p.ok) unparsed.push(`지원사업 · ${clean(r[1])} · ${periodRaw}`)
    const title = clean(r[1])!
    out.push({
      kind: "GRANT", title, subject: clean(r[2]), organizer: clean(r[3]), periodRaw, ...p,
      fundingKrw: thousand(r[5]), role: clean(r[6]), status: clean(r[7]),
      ownCashKrw: thousand(r[8]), ownInKindKrw: thousand(r[9]), grantNo: clean(r[10]), note: clean(r[11]),
      source: "지원사업", projectName: GRANT_PROJECT.find(([re]) => re.test(title))?.[1],
    })
  }

  // 수상 — 날짜 '2025.07.04' 또는 '2026.09.'
  for (const r of rows(wb, "경진대회 수상이력").slice(1)) {
    if (clean(r[1]) === null) continue
    const periodRaw = clean(r[4])
    const p = parsePeriod(periodRaw)
    if (periodRaw && !p.ok) unparsed.push(`수상 · ${clean(r[1])} · ${periodRaw}`)
    out.push({ kind: "AWARD", title: clean(r[1])!, prize: clean(r[2]), organizer: clean(r[3]), periodRaw, ...p, status: "수상", note: null, source: "수상" })
  }

  // 학회 — 좌: 자사(순번·학회명·장소·기간·결과) · 우: 대리점(순번·대리점·학회명·기간·결과). 학회명이 비면 건너뛴다
  for (const r of rows(wb, "홍보 및 부스운영").slice(2)) {
    if (clean(r[1])) {
      const periodRaw = clean(r[3]); const p = parsePeriod(periodRaw)
      if (periodRaw && !p.ok) unparsed.push(`학회 · ${clean(r[1])} · ${periodRaw}`)
      out.push({ kind: "EXHIBITION", title: clean(r[1])!, venue: clean(r[2]), organizer: null, periodRaw, ...p, status: clean(r[4]), note: null, source: "학회" })
    }
    if (clean(r[8])) {
      const periodRaw = clean(r[9]); const p = parsePeriod(periodRaw)
      if (periodRaw && !p.ok) unparsed.push(`학회(대리점) · ${clean(r[8])} · ${periodRaw}`)
      out.push({ kind: "EXHIBITION", title: clean(r[8])!, partner: clean(r[7]), organizer: null, periodRaw, ...p, status: clean(r[10]), note: null, source: "학회" })
    }
  }
  return { records: out, unparsed }
}

const HISTORY_KIND: Record<string, RecordKind> = { 내부행사: "INTERNAL", 포럼: "FORUM", 교육: "EDUCATION", 네트워킹: "NETWORKING", 주요: "MILESTONE" }
const IP_ROW = /특허\s*출원|상표\s*출원|상표\s*등록|상표출원|등록\s*공고/

function loadHistory(sheetRecords: RecordDraft[]) {
  const wb = readXlsx(join(RECORDS, "history_260316.xlsx"))
  const created: RecordDraft[] = []
  const merged: { history: string; historyDate: string; into: RecordDraft; dateDiffers: boolean }[] = []
  const skippedIp: string[] = []
  const noDate: string[] = []

  for (const r of rows(wb, "하드사이언스_주요연혁").slice(3)) {
    const category = clean(r[0]); const name = clean(r[2])
    if (!category || !name) continue
    if (IP_ROW.test(name)) { skippedIp.push(name); continue }

    let startsOn: Date | null = null
    if (typeof r[1] === "number") {
      const d = XLSX.SSF.parse_date_code(r[1])
      startsOn = ymd(d.y, d.m, d.d)
    } else noDate.push(`${name} (${clean(r[1])})`)

    // 상세 시트에 같은 사실이 있으면 합친다 — 날짜가 달라도 시트가 정본 (2026-09-10 결정)
    const tk = tokens(name)
    const days = (s: RecordDraft) => (startsOn && s.startsOn ? Math.abs(startsOn.getTime() - s.startsOn.getTime()) / 86_400_000 : 0)
    const inWindow = sheetRecords.filter((s) => days(s) <= 60)
    // 수상 문구는 수상 기록을 먼저 본다 — 같은 대회가 지원사업 시트에도 있다(여성창업경진대회)
    const preferAward = /수상|입상|표창/.test(name)
    const scored = inWindow
      .map((s) => ({ s, score: matchScore(tk, tokens(s.title)) + (preferAward && s.kind === "AWARD" ? 0.75 : 0) }))
      .filter((x) => x.score >= (preferAward && x.s.kind === "AWARD" ? 1 : 0.5) && matchScore(tk, tokens(x.s.title)) > 0)
      // 점수가 같으면 자사 기록(대리점 칸이 빈 것)을 먼저 — 회사 연혁이다. 그다음 날짜가 가까운 것
      .sort((a, b) => b.score - a.score || Number(!!a.s.partner) - Number(!!b.s.partner) || days(a.s) - days(b.s))
    const match = scored[0]?.s
    if (match) {
      match.category = match.category ?? category
      match.note = [match.note, `연혁: ${name} (${iso(startsOn)})`].filter(Boolean).join(" · ")
      merged.push({ history: name, historyDate: iso(startsOn), into: match, dateDiffers: !!startsOn && iso(startsOn) !== iso(match.startsOn) })
      continue
    }

    const kind: RecordKind = category === "주요" && /수상|표창/.test(name) ? "AWARD" : (HISTORY_KIND[category] ?? "MILESTONE")
    created.push({ kind, title: name, organizer: null, periodRaw: null, startsOn, endsOn: startsOn, status: "완료", note: null, category, source: "연혁" })
  }
  return { created, merged, skippedIp, noDate }
}

/** 노션 「HADD Science History」 — 이름과 달리 2026 추진 계획이다. 시트와 겹치면 시트가 정본 */
function loadNotionPlans(existing: RecordDraft[]) {
  const top = JSON.parse(readFileSync(join(NOTION, "rows.json"), "utf8")) as { 항목명: string; body: { type: string; text: string }[] }[]
  const page = top.find((r) => r.항목명 === "HADD Science History")
  const plans: RecordDraft[] = []
  const overlap: string[] = []
  if (!page) return { plans, overlap }
  let section: "GRANT" | "EXHIBITION" = "GRANT"
  for (const b of page.body) {
    const t = clean(b.text)
    if (!t) continue
    if (t.includes("주요 추진 과제")) { section = "GRANT"; continue }
    if (t.includes("전시/학술")) { section = "EXHIBITION"; continue }
    const m = t.match(/^-\s*(.+?)(?:\s*\(([^)]+)\))?\s*$/)
    if (!m) continue
    const title = m[1].trim(); const org = m[2]?.trim() ?? null
    const tk = tokens(title)
    // 계획은 2026년이다 — 2026년에 걸친 기록하고만 맞춘다 (2024년 오가노이드학회 부스에 붙던 오탐)
    const dup = existing
      .filter((e) => (e.startsOn?.getUTCFullYear() ?? 0) === 2026 || (e.endsOn?.getUTCFullYear() ?? 0) >= 2026)
      .map((e) => ({ e, score: matchScore(tk, tokens(e.title)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.e
    if (dup) { overlap.push(`${title} ↔ ${dup.title}`); continue }
    plans.push({ kind: section, title, organizer: section === "GRANT" ? org : null, periodRaw: "2026", startsOn: ymd(2026, 1, 1), endsOn: ymd(2026, 12, 31), status: "계획", note: org && section !== "GRANT" ? org : null, source: "노션" })
  }
  return { plans, overlap }
}

async function importRecords() {
  const { records: sheet, unparsed } = loadSheetRecords()
  const { created: history, merged, skippedIp, noDate } = loadHistory(sheet)
  const { plans, overlap } = loadNotionPlans([...sheet, ...history])
  const all = [...sheet, ...history, ...plans]

  const byKind = all.reduce<Record<string, number>>((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {})
  const bySource = all.reduce<Record<string, number>>((a, r) => ((a[r.source] = (a[r.source] ?? 0) + 1), a), {})
  const funding = sheet.filter((r) => r.kind === "GRANT").reduce((a, r) => a + (r.fundingKrw ?? BigInt(0)), BigInt(0))
  console.log(`\n━━ 연혁·실적 ${all.length}건`)
  console.log("  종류:", byKind)
  console.log("  출처:", bySource)
  console.log(`  지원금 합계 ${won(funding)}원 (엑셀 합계행 847,700천원과 대조)`)
  console.log(`  연혁 → 시트에 합침 ${merged.length}건 · 특허·상표 행 건너뜀 ${skippedIp.length}건 · 날짜 없음 ${noDate.length}건 · 기간 못 읽음 ${unparsed.length}건`)
  if (unparsed.length) unparsed.forEach((u) => console.log("   ✗ 기간:", u))
  noDate.forEach((u) => console.log("   · 날짜 없음:", u))
  console.log("  합친 것 (시트가 정본):")
  for (const m of merged) console.log(`   ${m.dateDiffers ? "≠" : "="} ${m.history} (${m.historyDate}) → [${m.into.source}] ${m.into.title} (${iso(m.into.startsOn)})`)
  console.log(`  노션 2026 계획 ${plans.length}건 · 시트와 겹쳐 뺀 것 ${overlap.length}건`)
  overlap.forEach((o) => console.log("   · 겹침:", o))

  const projects = await prisma.project.findMany({ where: { name: { in: GRANT_PROJECT.map(([, n]) => n) } }, select: { id: true, name: true } })
  const missingProjects = GRANT_PROJECT.map(([, n]) => n).filter((n) => !projects.some((p) => p.name === n))
  console.log(`  프로젝트 연결 ${sheet.filter((r) => r.projectName).length}건${missingProjects.length ? ` · 못 찾은 프로젝트: ${missingProjects.join(", ")}` : ""}`)

  if (!APPLY) return
  let n = 0
  for (const r of all) {
    // parsePeriod 결과를 펼쳐 넣어 `ok` 가 섞여 있다 — 모델에 없는 칸이라 걷어낸다
    const { projectName, ...rest } = r as RecordDraft & { ok?: boolean }
    delete (rest as { ok?: boolean }).ok
    const data = { ...rest, projectId: projects.find((p) => p.name === projectName)?.id ?? null }
    await prisma.companyRecord.upsert({ where: { dedupeKey: dedupeKey(r) }, create: { dedupeKey: dedupeKey(r), ...data }, update: data })
    n++
  }
  console.log(`  ✓ 기록 ${n}건 upsert · DB ${await prisma.companyRecord.count()}건`)
}

// ─── 인력 + 서명 ─────────────────────────────────────────────────

interface Corrections {
  phones: Record<string, string>
  employed: string[]
  notEmployed: string[]
  insured4: string[]
  concurrent: Record<string, { affiliation: string; haddRole: string }>
  affiliation: Record<string, string>
  sealNotSignature: string[]
}

function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

async function importStaff() {
  const cds = JSON.parse(readFileSync(join(NOTION, "child_databases.json"), "utf8")) as Record<string, { rows: Record<string, unknown>[] }>
  const staffRows = Object.entries(cds).find(([k]) => k.includes("직원"))?.[1].rows ?? []
  const corr = JSON.parse(readFileSync(join(NOTION, "corrections.json"), "utf8")) as Corrections
  const users = await prisma.user.findMany({ select: { id: true, name: true } })
  const sigDir = join(NOTION, "signatures")
  const sigFiles = existsSync(sigDir) ? readdirSync(sigDir) : []

  console.log(`\n━━ 인력 ${staffRows.length}명`)
  const plans: { data: Prisma.StaffProfileUncheckedCreateInput; sig?: { file: string; kind: "SIGNATURE" | "SEAL" } }[] = []
  for (const r of staffRows) {
    const name = clean(r["이름"])!
    const employed = corr.employed.includes(name)
    if (!employed && !corr.notEmployed.includes(name)) console.log(`   ⚠ 정정 목록에 없는 사람: ${name} — 비재직으로 둔다`)
    const affiliation = corr.concurrent[name]?.affiliation ?? corr.affiliation[name] ?? clean(r["소속"]) ?? "하드사이언스"
    const base: Prisma.StaffProfileUncheckedCreateInput = {
      name, affiliation, employment: employed ? "EMPLOYED" : "FORMER",
      userId: users.find((u) => u.name === name)?.id ?? null,
    }
    // 비재직은 이름 · 소속 · 비재직 표시만 (2026-09-14 결정)
    const data: Prisma.StaffProfileUncheckedCreateInput = employed
      ? {
          ...base,
          position: clean(r["직책"]),
          haddRole: corr.concurrent[name]?.haddRole ?? null,
          insured: corr.insured4.includes(name),
          education: clean(r["학력"]), major: clean(r["전공"]), duties: clean(r["담당 업무"]),
          ntisNo: clean(r["과학기술인번호 NTIS"]), email: clean(r["이메일"]),
          phone: corr.phones[name] ?? clean(r["연락처"]),
          birthDate: clean(r["생년월일"]) ? new Date(`${clean(r["생년월일"])}T00:00:00Z`) : null,
        }
      : base
    const file = employed ? sigFiles.find((f) => f.startsWith(`${name}__`)) : undefined
    plans.push({ data, sig: file ? { file, kind: corr.sealNotSignature.includes(name) ? "SEAL" : "SIGNATURE" } : undefined })
    const d = data as Record<string, unknown>
    console.log(
      `   ${employed ? "재직" : "비재직"} ${name} · ${affiliation}${d.position ? ` · ${d.position}` : ""}${d.haddRole ? ` · 하드사이언스 ${d.haddRole}` : ""}` +
        `${d.insured ? " · 4대보험" : ""}${base.userId ? " · 옴니스 계정 연결" : ""}${file ? ` · ${corr.sealNotSignature.includes(name) ? "직인" : "서명"} 1` : ""}` +
        `${employed ? ` · 채운 칸 ${Object.values(d).filter((v) => v !== null && v !== undefined && v !== "").length}` : ""}`
    )
  }
  const skippedSigs = sigFiles.filter((f) => !plans.some((p) => p.sig?.file === f))
  console.log(`  서명·직인 올릴 것 ${plans.filter((p) => p.sig).length} · 옮기지 않는 것(비재직) ${skippedSigs.length}: ${skippedSigs.map((f) => f.split("__")[0]).join(", ")}`)

  if (!APPLY) return
  for (const p of plans) {
    const staff = await prisma.staffProfile.upsert({ where: { name: p.data.name }, create: p.data, update: p.data })
    if (!p.sig) continue
    const buf = readFileSync(join(sigDir, p.sig.file))
    const hash = createHash("md5").update(buf).digest("hex").slice(0, 12)
    const objectKey = `staff/${staff.id}/${p.sig.kind.toLowerCase()}-${hash}.png`
    const exists = await prisma.staffAsset.findFirst({ where: { staffId: staff.id, objectKey } })
    if (exists) continue
    await putObject(objectKey, buf, "image/png")
    const size = pngSize(buf)
    await prisma.staffAsset.create({
      data: { staffId: staff.id, kind: p.sig.kind, objectKey, fileName: p.sig.file.split("__")[1] ?? "signature.png", mimeType: "image/png", size: buf.length, width: size?.width, height: size?.height },
    })
  }
  console.log(`  ✓ 인력 ${await prisma.staffProfile.count()}명 · 서명·직인 ${await prisma.staffAsset.count()}장`)
}

// ─── 회사 기본정보 ─────────────────────────────────────────────────

async function importCompany() {
  const top = JSON.parse(readFileSync(join(NOTION, "rows.json"), "utf8")) as { 항목명: string; body: { text: string; children?: { text: string }[] }[] }[]
  const page = top.find((r) => r.항목명 === "기업 개요")
  if (!page) throw new Error("노션 「기업 개요」 행이 없습니다")
  const text = page.body.flatMap((b) => [b.text, ...(b.children ?? []).map((c) => c.text)]).join("\n").replace(/﻿/g, "")

  const pick = (re: RegExp) => clean(text.match(re)?.[1])
  const nameM = text.match(/회사명\s*:\s*(\S+)\s*\(([^)]+)\)/)
  const founded = text.match(/설립일\s*:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  const data = {
    nameKo: nameM?.[1] ?? "하드사이언스",
    nameEn: nameM?.[2] ?? "HADD Science",
    bizRegNo: pick(/사업자등록번호\s*:\s*(\d{3}-\d{2}-\d{5})/) ?? OUR_BIZ_NO,
    industryCode: pick(/(\d{6})\s*\(국세청\)/),
    industry: pick(/\d{6}\s*\(국세청\)\s*([^\n]+)/),
    foundedOn: founded ? ymd(Number(founded[1]), Number(founded[2]), Number(founded[3])) : null,
    homepage: pick(/(https?:\/\/\S+)/),
    hqAddress: pick(/본사\s*:\s*([^\n]+)/),
    labAddress: pick(/연구소\s*:\s*([^\n]+)/),
    partnerAddress: pick(/연구협력기관\s*:\s*([^\n]+)/),
    // 법인 전환은 아직 안 했고 2026년에는 하지 않을 예정 (작업지시자 확인 2026-09-14)
    bizType: "개인과세사업자",
    asOfDate: ymd(2026, 3, 23),
  }
  console.log("\n━━ 회사 기본정보")
  for (const [k, v] of Object.entries(data)) console.log(`   ${k}: ${v instanceof Date ? iso(v) : (v ?? "—")}`)
  if (data.bizRegNo !== OUR_BIZ_NO) console.log(`   ⚠ 사업자번호가 세금계산서(${OUR_BIZ_NO})와 다르다`)
  console.log("   bizType: 개인과세사업자 — 법인 전환 전(2026년에는 전환하지 않음, 2026-09-14 확인)")
  if (!APPLY) return
  await prisma.companyProfile.upsert({ where: { id: "hadd" }, create: { id: "hadd", ...data }, update: data })
  console.log("  ✓ 회사 기본정보 저장")
}

// ─── 연도별 재무 ────────────────────────────────────────────────

/** 표준재무제표(증명) PDF 에서 숫자를 읽는다. 로컬 전용 — pdftotext 가 있어야 한다 */
function readStatement(file: string) {
  const t = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" })
  const year = Number(t.match(/(\d{4})년\s*귀속분/)?.[1])
  // 한 줄에 왼쪽·오른쪽 두 계정이 나란히 있다 — "1.상품매출 02 0 10.유류비 31 0". 계정 이름 · 코드 두 자리 · 금액 순서로 읽는다
  const num = (label: RegExp) => {
    const m = t.match(new RegExp(label.source + "\\s+\\d{2}\\s+([\\d,]+)"))
    return m ? BigInt(m[1].replace(/,/g, "")) : null
  }
  const revenueLines = [["상품매출", /1\.상품매출/], ["제품매출", /2\.제품매출/], ["서비스수입", /6\.서비스수입/], ["기타", /7\.기타\s+08/]] as const
  const nonZero = revenueLines.map(([name, re]) => [name, num(re)] as const).filter(([, v]) => v && v > BigInt(0))
  return {
    year,
    revenueKrw: num(/Ⅰ\.매출액/),
    costOfSalesKrw: num(/Ⅱ\.매출원가/),
    netIncomeKrw: num(/Ⅳ\.당기순이익/),
    assetsKrw: num(/자산총계\(Ⅰ\+Ⅱ\)/),
    liabilitiesKrw: num(/부채총계\(Ⅰ\+Ⅱ\)/),
    equityKrw: num(/자본총계\(Ⅲ\+Ⅳ\)/),
    accountLabel: nonZero.map(([n]) => n).join(" · ") || null,
  }
}

async function importYears() {
  const dir = join(NOTION, "statements")
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".pdf")) : []
  // 상시근로자는 노션 기업 개요의 "2024년 0명 / 2025년 2명"
  const top = JSON.parse(readFileSync(join(NOTION, "rows.json"), "utf8")) as { 항목명: string; body: { text: string }[] }[]
  const overview = top.find((r) => r.항목명 === "기업 개요")?.body.map((b) => b.text).join("\n") ?? ""
  const headcount = Object.fromEntries([...overview.matchAll(/(\d{4})년\s*(\d+)명/g)].map((m) => [Number(m[1]), Number(m[2])]))

  // 제품·용역 구분은 세금계산서 품목에서 (결산서에는 계정만 있다). 2025 는 PDF 11장, 2024 는 정리표 4건(전부 제품)
  const split: Record<number, { product: bigint; service: bigint; note: string }> = {
    2024: { product: BigInt(3_600_000), service: BigInt(0), note: "제품·용역 구분은 세금계산서 정리표(4건) 공급가 기준 — 결산서와 800원 차이" },
    2025: { product: BigInt(34_751_550), service: BigInt(272_727_273), note: "제품·용역 구분은 세금계산서 11장 공급가 기준(2025-02-04 국일그래핀 1장은 이미지 PDF 라 Gemini 로 판독 — 공급가 3,150,000 확인)" },
  }

  console.log(`\n━━ 연도별 재무 (결산서 ${files.length}개)`)
  const planned: Prisma.CompanyYearUncheckedCreateInput[] = []
  const confirmed: Prisma.CompanyYearUncheckedCreateInput[] = []
  for (const f of files) {
    const s = readStatement(join(dir, f))
    if (!s.year) { console.log(`   ✗ 귀속연도를 못 읽음: ${f}`); continue }
    const sp = split[s.year]
    confirmed.push({
      year: s.year, basis: "CONFIRMED", revenueKrw: s.revenueKrw, costOfSalesKrw: s.costOfSalesKrw, netIncomeKrw: s.netIncomeKrw,
      assetsKrw: s.assetsKrw, liabilitiesKrw: s.liabilitiesKrw, equityKrw: s.equityKrw,
      revenueProductKrw: sp?.product ?? null, revenueServiceKrw: sp?.service ?? null,
      headcount: headcount[s.year] ?? null, accountLabel: s.accountLabel, note: sp?.note ?? null,
      sourceFileKey: `import:${f}`,
    })
  }
  // 노션 재무현황의 예상·추정 — 계획 단계. 2025 확정(3.07억)보다 낮게 잡혀 있어(제품만 본 숫자) 재검토 표시를 단다
  planned.push(
    { year: 2026, basis: "PLANNED", revenueKrw: BigInt(50_000_000), note: "노션 재무현황 '26 예상(2026-777 신청서 v2). 제품 매출만 본 숫자라 2025 확정 매출(307,481,423원)과 기준이 다르다 — 재검토 필요" },
    { year: 2027, basis: "PLANNED", revenueKrw: BigInt(150_000_000), note: "노션 재무현황 '27 추정. 위와 같은 이유로 재검토 필요" },
  )
  for (const y of [...confirmed, ...planned]) {
    console.log(
      `   ${y.year} ${y.basis === "CONFIRMED" ? "확정" : "계획"} · 매출 ${won(y.revenueKrw as bigint)}` +
        `${y.revenueProductKrw !== undefined && y.revenueProductKrw !== null ? ` (제품 ${won(y.revenueProductKrw as bigint)} · 용역 ${won(y.revenueServiceKrw as bigint)})` : ""}` +
        `${y.assetsKrw ? ` · 자산 ${won(y.assetsKrw as bigint)} · 부채 ${won(y.liabilitiesKrw as bigint)} · 자본 ${won(y.equityKrw as bigint)} · 순이익 ${won(y.netIncomeKrw as bigint)}` : ""}` +
        `${y.headcount !== undefined && y.headcount !== null ? ` · 상시근로자 ${y.headcount}` : ""}${y.accountLabel ? ` · 계정 ${y.accountLabel}` : ""}`
    )
    if (y.revenueProductKrw && y.revenueKrw) {
      const diff = Number(y.revenueKrw) - Number(y.revenueProductKrw) - Number(y.revenueServiceKrw ?? 0)
      console.log(`      결산 매출 − (제품+용역) = ${diff.toLocaleString("ko-KR")}원`)
    }
  }
  if (!APPLY) return
  for (const y of [...confirmed, ...planned]) {
    await prisma.companyYear.upsert({ where: { year_basis: { year: y.year, basis: y.basis } }, create: y, update: y })
  }
  console.log(`  ✓ 연도 ${await prisma.companyYear.count()}행`)
}

// ─── 시장기업 ──────────────────────────────────────────────────

const COUNTRIES = new Set(["스위스", "독일", "미국", "영국", "오스트리아", "네덜란드", "일본", "프랑스", "중국", "캐나다", "덴마크", "스웨덴", "이스라엘", "벨기에", "호주", "싱가포르", "한국"])

async function importMarket() {
  const cds = JSON.parse(readFileSync(join(NOTION, "child_databases.json"), "utf8")) as Record<string, { rows: Record<string, unknown>[] }>
  const src = Object.entries(cds).find(([k]) => k.includes("3D Organoid"))?.[1].rows ?? []
  const data = src
    .map((r) => {
      const name = clean(r["Name"])
      if (!name) return null
      const paren = name.match(/\(([^)]+)\)\s*$/)?.[1]
      const aa = clean(r["동물대체시험법"])
      return {
        name,
        country: paren && COUNTRIES.has(paren) ? paren : null,
        segment: clean(r["분류"]), homepage: clean(r["홈페이지"]), products: clean(r["주력상품"]), industry: clean(r["업종"]),
        ceo: clean(r["대표자명"]), foundedRaw: clean(r["설립/업력"]), capitalRaw: clean(r["자본금"]), revenueRaw: clean(r["매출액"]),
        headcountRaw: clean(r["사원수(규모)"]), animalAlternative: aa === "O" ? true : aa === "X" ? false : null, address: clean(r["기업주소"]),
        source: "notion",
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  const filled = data.filter((d) => [d.products, d.industry, d.ceo, d.foundedRaw, d.revenueRaw].filter(Boolean).length >= 2).length
  const bySeg = data.reduce<Record<string, number>>((a, d) => ((a[d.segment ?? "(빈칸)"] = (a[d.segment ?? "(빈칸)"] ?? 0) + 1), a), {})
  console.log(`\n━━ 시장기업 ${data.length}곳 · 내용 있는 곳 ${filled} · 국가 칸 채움 ${data.filter((d) => d.country).length}`)
  console.log("  분류:", bySeg)
  const dupNames = data.map((d) => d.name).filter((n, i, a) => a.indexOf(n) !== i)
  if (dupNames.length) console.log("   ⚠ 같은 이름:", dupNames)
  if (!APPLY) return
  for (const d of data) await prisma.marketCompany.upsert({ where: { name: d.name }, create: d, update: d })
  console.log(`  ✓ 시장기업 ${await prisma.marketCompany.count()}곳`)
}

// ─── 세금계산서 ───────────────────────────────────────────────

async function importInvoices() {
  const dir = join(NOTION, "invoices")
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf")).sort() : []
  const allowVision = args.includes("--vision") || args.includes("--accept-vision")
  const acceptVision = args.includes("--accept-vision")
  const orgs = await prisma.crmOrg.findMany({ include: { quotes: { include: { items: true } } } })
  const existing = new Set((await prisma.taxInvoice.findMany({ select: { approvalNo: true } })).map((x) => x.approvalNo))

  console.log(`\n━━ 세금계산서 ${files.length}장 (AI 판독 ${allowVision ? "허용" : "안 함 — 이미지 PDF 는 건너뜀"})`)
  type Plan = { file: string; r: ParsedInvoice; org: (typeof orgs)[number] | null; newOrg: boolean; quote: { id: string; code: string } | null }
  const plans: Plan[] = []
  const years: Record<string, { product: number; service: number; n: number }> = {}
  for (const f of files) {
    const data = new Uint8Array(readFileSync(join(dir, f)))
    const r = await readInvoice(data, "application/pdf", { allowVision })
    const pass = r.checks.problems.length === 0
    if (!pass) { console.log(`   ✗ ${f} — ${r.checks.problems.join(" · ")}`); continue }
    const counterBiz = r.direction === "SALE" ? r.buyerBizNo : r.supplierBizNo
    const counterName = r.direction === "SALE" ? r.buyerName : r.supplierName
    const { org, how } = matchOrg(orgs, counterName, counterBiz, r.totalKrw, r.issuedOn)
    const quote: Plan["quote"] = org ? matchQuote(org, r.totalKrw, r.issuedOn) : null
    const elsewhere = quote ? [] : quotesElsewhere(orgs, org?.id ?? null, r.totalKrw, r.issuedOn)
    plans.push({ file: f, r, org, newOrg: !org, quote })
    if (r.direction === "SALE" && r.issuedOn) {
      const y = r.issuedOn.slice(0, 4); years[y] ??= { product: 0, service: 0, n: 0 }; years[y].n++
      for (const it of r.items) years[y][it.category === "용역" ? "service" : "product"] += it.supplyKrw
    }
    console.log(
      `   ${existing.has(r.approvalNo!) ? "= 이미 있음" : "+"} ${r.issuedOn} ${r.direction === "SALE" ? "매출" : "매입"} [${r.readBy === "vision" ? "AI 판독" : "글자"}] ${counterName}(${counterBiz})` +
        ` → ${org ? `기관 ${org.code} ${org.name} (${how})${org.bizRegNo ? "" : " · 사업자번호 채움"}` : "새 기관 만듦"}` +
        `${quote ? ` · 견적 ${quote.code}` : ""}${elsewhere.length ? ` · ⚠ 합계 맞는 견적이 다른 기관에: ${elsewhere.map((e) => `${e.orgName} ${e.quoteCode}`).join(", ")}` : ""} · 공급가 ${won(r.supplyKrw)} · ${r.items.map((i) => `${i.category}:${i.name}`).join(", ")}` +
        `${r.kind === "수정" ? ` · 수정(당초 ${r.originalApprovalNo ?? "?"})` : ""}`
    )
  }
  for (const [y, v] of Object.entries(years)) console.log(`  ${y} 매출 ${v.n}장 · 제품 ${won(v.product)} · 용역 ${won(v.service)} · 합 ${won(v.product + v.service)}`)
  const visionCount = plans.filter((p) => p.r.readBy === "vision").length
  if (visionCount && !acceptVision) console.log(`  AI 판독 ${visionCount}장은 --accept-vision 이 있어야 저장한다 (사람 확인 뒤)`)

  if (!APPLY) return
  // 저장은 CRM 업로드 화면과 같은 길(lib/tax-invoice-save)로 한다. 앞에서 새 기관이 생겼을 수 있어 장마다 다시 계획한다
  let created = 0
  for (const p of plans) {
    const r = p.r
    if (existing.has(r.approvalNo!)) continue
    if (r.readBy === "vision" && !acceptVision) continue
    const plan = await planInvoice(r)
    await saveInvoice(r, plan, { data: readFileSync(join(dir, p.file)), mimeType: "application/pdf", fileName: p.file }, null)
    created++
  }
  console.log(`  ✓ 세금계산서 ${created}장 저장 · DB ${await prisma.taxInvoice.count()}장 · 기관 ${await prisma.crmOrg.count()}곳`)
}

// ─── 실행 ─────────────────────────────────────────────────────

async function main() {
  const db = (await prisma.$queryRaw<{ db: string }[]>`select current_database() db`)[0].db
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} · DB ${db} · 입력 ${IMPORT_DIR}`)
  if (APPLY && db === "omnis" && !args.includes("--i-know-this-is-shared")) {
    throw new Error("로컬 공용 DB(omnis)에는 쓰지 않는다 — 온보딩 작업이 같은 DB 를 쓴다. omnis_context 에서 돌리거나 --i-know-this-is-shared")
  }
  if (want("records")) await importRecords()
  if (want("staff")) await importStaff()
  if (want("company")) await importCompany()
  if (want("years")) await importYears()
  if (want("market")) await importMarket()
  if (want("invoices")) await importInvoices()
  if (!APPLY) console.log("\n(dry-run — 아무것도 쓰지 않았다. --apply 로 쓴다)")
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
