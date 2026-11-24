// 채용 지원서 규칙 — 검사 · 조각 · 티켓 · 보관 기한. prisma 를 들이지 않는다(단위 시험이 DB 없이 돈다).
//
// 계약의 정본: ~/work/omnis-reports/omnis-hr-api-contract-261124.md (홈페이지 hadd-website 와 맞춘 것)
// 칸 · 길이는 홈페이지 lib/career-application.ts 와 같아야 한다. 어긋나면 지원자는 화면에서 통과하고 여기서 400 을 받는다 —
// 그러면 홈페이지가 메일 되돌림을 띄우니 지원서를 잃지는 않지만, 고칠 일이다.
import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

/** 이력서 한 개의 상한 — 홈페이지 lib/career-application.ts 와 같다 */
export const APPLICATION_FILE_MAX_BYTES = 10 * 1024 * 1024
/** 포트폴리오 한 개의 상한 — 작업지시자 결정(2026-11-24) 10MB → 30MB. 이력서는 10MB 그대로. 30MB 면 조각 8개 */
export const PORTFOLIO_FILE_MAX_BYTES = 30 * 1024 * 1024
/** 조각 하나 — Vercel 함수 본문 한도(4.5MB)보다 넉넉히 작게. 10MB 면 3조각 */
export const PART_BYTES = 4_000_000
/** 조각 티켓 유효 시간 */
export const TICKET_TTL_MS = 30 * 60_000
/** 접수(complete) 되지 않은 지원서를 지우는 때 */
export const RECEIVING_TTL_MS = 24 * 3600_000
/** 같은 이메일 · 같은 공고를 같은 지원서로 보는 창 — 홈페이지 omnisFetch 의 재시도 · 두 번 누르기 */
export const DUPLICATE_WINDOW_MS = 5 * 60_000
/** 시도 제한 — 하루(24시간) 기준 */
export const RATE_LIMITS = { perEmail: 5, perIp: 20 } as const
/** 「선발 종료」 뒤 보관 — 동의 안내 「선발 종료 후 6개월」 */
export const RETENTION_MONTHS_AFTER_SELECTION = 6
/** 「선발 종료」 를 누르지 않았을 때의 안전장치 — 접수 뒤 12개월(결정 D3) */
export const RETENTION_MONTHS_FALLBACK = 12

export const SLOTS = ["resume", "portfolio"] as const
export type SlotParam = (typeof SLOTS)[number]
export const SLOT_DB = { resume: "RESUME", portfolio: "PORTFOLIO" } as const
export type SlotDb = (typeof SLOT_DB)[SlotParam]
export const SLOT_LABEL: Record<SlotDb, string> = { RESUME: "이력서", PORTFOLIO: "포트폴리오" }
export const slotParam = (db: SlotDb): SlotParam => (db === "RESUME" ? "resume" : "portfolio")
/** 칸마다 파일 상한 — 열 때(검사)와 조각을 받을 때(intake.receivePart) 같은 값을 본다 */
export const slotMaxBytes = (slot: SlotParam) => (slot === "resume" ? APPLICATION_FILE_MAX_BYTES : PORTFOLIO_FILE_MAX_BYTES)
export const parseSlot = (v: string): SlotParam | null => ((SLOTS as readonly string[]).includes(v) ? (v as SlotParam) : null)

export const STAGE_LABEL = {
  RECEIVING: "올리는 중",
  RECEIVED: "접수",
  SCREENING: "서류",
  INTERVIEW: "면접",
  OFFERED: "합격",
  REJECTED: "불합격",
  WITHDRAWN: "지원 취소",
  HIRED: "입사",
} as const
export type Stage = keyof typeof STAGE_LABEL

// ─── 관심 있는 일 ───
//
// 홈페이지 공고의 tracks(content/ko.ts career.jobs[].tracks)에서 고른 value. 홈페이지 API 가 그 공고의 tracks 로 먼저 거른다.
// 갈래는 공고마다 다를 수 있어 여기서는 모양(slug)만 보고, 아는 것은 라벨로 보여 준다(모르는 값은 그대로).
export const INTEREST_LABEL: Record<string, string> = {
  "ai-bio": "AI 기반 바이오 연구",
  dev: "사내 업무 시스템(옴니스) · 홈페이지 개발",
  grants: "국가과제 · TIPS 같은 지원 서류 작성",
}
/** 영문 지원서용 — 홈페이지 content/en.ts 의 tracks 라벨과 같다 */
export const INTEREST_LABEL_EN: Record<string, string> = {
  "ai-bio": "AI-driven bio research",
  dev: "Developing our internal work system (Omnis) and website",
  grants: "Writing applications for national R&D programs and TIPS",
}
export const interestLabel = (v: string, lang: "ko" | "en" = "ko") => (lang === "en" ? INTEREST_LABEL_EN[v] : INTEREST_LABEL[v]) ?? v
export const MAX_INTERESTS = 10

// ─── 검사 ───

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE = /^[0-9+\-\s()]{9,30}$/

const text = (max: number) => z.string().trim().min(1, "필수").max(max, `${max}자 이하`)
const fileMeta = (maxBytes: number) =>
  z.object({
    name: z.string().trim().min(1).max(255).refine((n) => n.toLowerCase().endsWith(".pdf"), "PDF 파일(.pdf)만"),
    size: z.number().int().min(1).max(maxBytes, `${maxBytes / 1024 / 1024}MB 이하`),
    type: z.string().max(100).optional().default(""),
  })
const httpUrl = z.string().trim().max(500).refine((v) => {
  if (v === "") return true
  try {
    const u = new URL(v)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}, "http · https 주소")

export const applicationIntakeSchema = z.object({
  job: z.string().regex(/^[a-z0-9-]{3,100}$/, "공고 slug"),
  jobTitle: text(200),
  lang: z.string().optional().transform((v) => (v === "en" ? "en" : "ko")),
  name: text(100),
  department: text(100),
  studentId: text(20).regex(/^\d+$/, "숫자만"),
  grade: text(20),
  graduation: text(50),
  phone: text(30).regex(PHONE, "연락처 모양"),
  email: text(200).regex(EMAIL, "이메일 모양"),
  portfolioUrl: httpUrl.optional().default(""),
  interests: z
    .array(z.string().trim().regex(/^[a-z0-9-]{1,40}$/, "관심 있는 일 value"))
    .max(MAX_INTERESTS, `${MAX_INTERESTS}개 이하`)
    .optional()
    .default([])
    .transform((v) => [...new Set(v)]),
  motivation: text(1500),
  consent: z.literal(true, { message: "동의가 필요합니다" }),
  consentVersion: text(100),
  resume: fileMeta(APPLICATION_FILE_MAX_BYTES),
  portfolioFile: fileMeta(PORTFOLIO_FILE_MAX_BYTES).nullable().optional().default(null),
  ip: z.string().trim().max(100).nullable().optional(),
  userAgent: z.string().trim().max(500).nullable().optional(),
})
export type ApplicationIntake = z.infer<typeof applicationIntakeSchema>

// ─── 조각 ───

export const partCount = (size: number, partBytes = PART_BYTES) => Math.max(1, Math.ceil(size / partBytes))

/**
 * 조각 n 이 받을 수 있는 것인가.
 * 조각은 차례로만 받는다 — 이어 쓰기(Content-Range)는 첫 조각에서 파일을 전체 크기로 만들어, NAS 크기만 봐서는
 * 다 왔는지 알 수 없다. 그래서 「앞에서부터 이어서 받은 바이트(receivedBytes)」 를 세고, 그 뒤 조각만 받는다.
 * 이미 받은 조각을 다시 보내는 것은 허용한다(같은 범위에 같은 바이트라 결과가 같다 — 재시도).
 */
export function partProblem(input: { part: number; bodyBytes: number; size: number; receivedBytes: number; partBytes?: number }): string | null {
  const partBytes = input.partBytes ?? PART_BYTES
  const parts = partCount(input.size, partBytes)
  if (!Number.isInteger(input.part) || input.part < 0 || input.part >= parts) return "조각 번호가 범위를 벗어났습니다"
  const start = input.part * partBytes
  const expected = Math.min(partBytes, input.size - start)
  if (input.bodyBytes !== expected) return `조각 크기가 ${expected}바이트여야 합니다`
  if (start > input.receivedBytes) return "앞 조각을 먼저 보내야 합니다"
  return null
}

export const partRange = (part: number, size: number, partBytes = PART_BYTES) => {
  const start = part * partBytes
  return { start, end: Math.min(size, start + partBytes) }
}

/** PDF 는 앞 네 바이트가 %PDF 다 — 브라우저가 붙인 type 은 믿지 않는다 */
export const looksLikePdf = (head: Buffer) => head.length >= 4 && head.subarray(0, 4).toString("latin1") === "%PDF"

// ─── 티켓 ───
//
// 브라우저가 쥐는 것. 할 수 있는 일은 「이 지원서의 이 칸에, 이 크기의 파일을, 만료 전까지 쓰기」 하나다.
// 읽기도, 다른 지원서 쓰기도 안 된다. 서명 키(WEBSITE_CAREER_UPLOAD_KEY)는 옴니스만 갖는다.

interface TicketClaims {
  a: string
  s: SlotParam
  z: number
  e: number
}

const b64 = (buf: Buffer) => buf.toString("base64url")
const sign = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest()

export function signTicket(claims: { applicationId: string; slot: SlotParam; size: number; expiresAt: number }, key: string): string {
  const payload = b64(Buffer.from(JSON.stringify({ a: claims.applicationId, s: claims.slot, z: claims.size, e: claims.expiresAt } satisfies TicketClaims)))
  return `${payload}.${b64(sign(payload, key))}`
}

export function verifyTicket(
  ticket: string,
  expect: { applicationId: string; slot: SlotParam },
  key: string,
  now = Date.now(),
): { ok: true; size: number } | { ok: false } {
  const [payload, mac, extra] = ticket.split(".")
  if (!payload || !mac || extra !== undefined) return { ok: false }
  const want = sign(payload, key)
  const given = Buffer.from(mac, "base64url")
  if (given.length !== want.length || !timingSafeEqual(given, want)) return { ok: false }
  let c: TicketClaims
  try {
    c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TicketClaims
  } catch {
    return { ok: false }
  }
  if (c.a !== expect.applicationId || c.s !== expect.slot || typeof c.z !== "number" || typeof c.e !== "number") return { ok: false }
  if (c.e <= now) return { ok: false }
  return { ok: true, size: c.z }
}

// ─── 비밀 · 오리진 ───

/** 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 거른다 */
export function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const DEFAULT_ORIGINS = ["https://haddscience.com", "https://www.haddscience.com"] as const

/** 조각을 보낼 수 있는 브라우저 오리진 — env WEBSITE_CAREER_ORIGINS(쉼표)가 있으면 그것만 */
export function allowedOrigins(env: string | undefined): string[] {
  const list = (env ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean)
  return list.length ? list : [...DEFAULT_ORIGINS]
}

// ─── 번호 · 보관 ───

const KST_MS = 9 * 3600_000
export function kstDay(d: Date): string {
  const k = new Date(d.getTime() + KST_MS)
  return `${String(k.getUTCFullYear()).slice(2)}${String(k.getUTCMonth() + 1).padStart(2, "0")}${String(k.getUTCDate()).padStart(2, "0")}`
}

/** 접수 번호 APP{yyMMdd}-{NNN} — 같은 날(서울) 이미 쓴 번호 다음 */
export function nextApplicationCode(day: string, used: readonly (string | null)[]): string {
  const prefix = `APP${day}-`
  const max = used.reduce((m, c) => (c?.startsWith(prefix) ? Math.max(m, Number(c.slice(prefix.length)) || 0) : m), 0)
  return `${prefix}${String(max + 1).padStart(3, "0")}`
}

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime())
  r.setUTCMonth(r.getUTCMonth() + months)
  return r
}

/** 파기할 때 — 「선발 종료」 + 6개월, 누르지 않았으면 접수 + 12개월. 둘 다 없으면(접수 전) null */
export function purgeDeadline(a: { selectionEndedAt: Date | null; receivedAt: Date | null; purgeAfter: Date | null }): Date | null {
  if (a.purgeAfter) return a.purgeAfter
  if (a.selectionEndedAt) return addMonths(a.selectionEndedAt, RETENTION_MONTHS_AFTER_SELECTION)
  if (a.receivedAt) return addMonths(a.receivedAt, RETENTION_MONTHS_FALLBACK)
  return null
}

/** 파기 때 비우는 지원서 칸 — 행은 집계(공고 · 단계 · 시각 · 번호)로 남긴다. 배열 칸 interests 는 upkeep 이 [] 로 비운다 */
export const PURGED_FIELDS = {
  name: null,
  department: null,
  studentId: null,
  grade: null,
  graduation: null,
  phone: null,
  email: null,
  portfolioUrl: null,
  motivation: null,
  ip: null,
  userAgent: null,
} as const

/** NAS 의 파일 키 — 이름에 지원자 이름을 넣지 않는다 */
export const applicationFileKey = (applicationId: string, slot: SlotParam) => `${applicationId}/${slot}.pdf`
