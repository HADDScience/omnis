// 공고 가점 ↔ 우리 인증 — 순수 함수만(prisma 없음). 추출 스크립트 · 화면 · AI/MCP 도구(grant_bonus_match)가 같이 쓴다.
//
// 흐름: 수집기 공고 본문 · 첨부 텍스트 → bonusExcerpt(가점 문맥만 잘라 붙임) → 모델이 항목을 뽑음 → parseBonusOutput
// (근거 문장이 원문에 없으면 버림) → GrantNotice.bonusItems 에 저장 → matchBonus 가 우리 인증(CompanyCertification)과 맞춘다.
import type { CertStatus } from "@/generated/prisma/client"

/** 공고가 주는 가점 한 항목 — 근거는 공고문 원문 그대로 */
export interface BonusItem {
  /** 공고에 적힌 이름(「벤처기업 확인 기업」) */
  label: string
  /** 그 항목의 점수(범위면 큰 쪽). 모르면 null */
  points: number | null
  /** 점수 원문(「최대 2점」) */
  pointsText: string | null
  /** 조건(「접수마감일 기준 유효한 확인서」 「주관기관에 한함」) */
  condition: string | null
  /** 근거 문장 — 공고 원문에서 그대로 */
  quote: string
  /** 근거가 있는 곳(「본문」 「첨부: 공고문.hwp」) */
  source: string | null
}

/** 가점 상한(「가점은 최대 5점까지」) */
export interface BonusCap {
  points: number | null
  text: string
  quote: string
}

export interface BonusExtract {
  items: BonusItem[]
  cap: BonusCap | null
}

// ─── 1. 가점 문맥 자르기 ───

/** 가점 문맥을 찾는 말 — 감점은 뽑지 않지만 같은 표에 있어 문맥에는 들어온다 */
export const BONUS_RX = /가점|가산|우대|인센티브/g

export interface TextPart {
  /** 「본문」 「첨부: 공고문.hwp」 */
  source: string
  text: string
}

/**
 * 본문 · 첨부에서 가점 문맥만 잘라 붙인다. 찾는 말 앞 400자 · 뒤 1,600자를 창으로 잡고 겹치면 합친다.
 * 합이 max 를 넘으면 앞에서부터 채운다. 찾는 말이 없으면 빈 글.
 */
export function bonusExcerpt(parts: TextPart[], max = 18_000): string {
  const out: string[] = []
  let used = 0
  for (const p of parts) {
    const text = p.text ?? ""
    const spans: [number, number][] = []
    for (const m of text.matchAll(BONUS_RX)) {
      const s = Math.max(0, m.index! - 400)
      const e = Math.min(text.length, m.index! + 1_600)
      const last = spans[spans.length - 1]
      if (last && s <= last[1]) last[1] = Math.max(last[1], e)
      else spans.push([s, e])
    }
    if (!spans.length) continue
    const body = spans.map(([s, e]) => text.slice(s, e).trim()).join("\n…\n")
    const head = `[[${p.source}]]\n`
    const room = max - used - head.length
    if (room <= 200) break
    const piece = head + body.slice(0, room)
    out.push(piece)
    used += piece.length + 2
  }
  return out.join("\n\n")
}

// ─── 2. 모델 출력 읽기 · 근거 확인 ───

/** 근거 대조용 — 표 기호 · 태그 · 강조 · 공백을 모두 걷는다(HWP→마크다운 변환 차이를 견딘다) */
export function squash(s: string): string {
  return s
    .normalize("NFC")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[\s*|\\`_#>~"'“”‘’「」『』()（）\[\]·ㆍ‧∙•▪ㅇ○◦□■※\-–—,.:;]/g, "")
}

/** 근거 문장이 원문에 있는가. 말줄임(…)으로 이은 인용은 조각마다 본다 */
export function quoteFound(quote: string, source: string): boolean {
  const hay = squash(source)
  const pieces = quote
    .split(/…|\.\.\./)
    .map(squash)
    .filter((p) => p.length > 0)
  return pieces.length > 0 && pieces.every((p) => p.length >= 4 && hay.includes(p))
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const m = v.match(/\d+(?:\.\d+)?/g)
    if (m) return Math.max(...m.map(Number))
  }
  return null
}
const text = (v: unknown, cap = 400) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, cap) : null

/** JSON 앞뒤에 글이나 ``` 가 붙어도 읽는다 */
function jsonOf(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "")
  const s = t.indexOf("{")
  const e = t.lastIndexOf("}")
  if (s < 0 || e <= s) return null
  try {
    return JSON.parse(t.slice(s, e + 1))
  } catch {
    return null
  }
}

/**
 * 모델 출력 → 저장 모양. 근거 문장이 원문(excerpt)에 없는 항목은 버린다(지어낸 근거).
 * 읽지 못하면 null. dropped 는 버린 항목 수(보고용)
 */
export function parseBonusOutput(
  raw: string,
  excerpt: string
): (BonusExtract & { dropped: number }) | null {
  const o = jsonOf(raw) as { items?: unknown; cap?: unknown } | null
  if (!o || typeof o !== "object" || !Array.isArray(o.items)) return null
  let dropped = 0
  const items: BonusItem[] = []
  const seen = new Set<string>()
  for (const x of o.items as Record<string, unknown>[]) {
    const label = text(x?.label, 120)
    const quote = text(x?.quote, 600)
    if (!label || !quote || !quoteFound(quote, excerpt)) {
      dropped++
      continue
    }
    const key = `${squash(label)}|${num(x.points)}`
    if (seen.has(key)) continue
    seen.add(key)
    items.push({
      label,
      points: num(x.points),
      pointsText: text(x.points_text, 60),
      condition: text(x.condition, 200),
      quote,
      source: readableSource(text(x.source, 120)),
    })
  }
  const c = o.cap as Record<string, unknown> | null | undefined
  const capQuote = text(c?.quote, 600)
  const cap: BonusCap | null =
    c && capQuote && quoteFound(capQuote, excerpt)
      ? { points: num(c.points), text: text(c.text, 120) ?? capQuote, quote: capQuote }
      : null
  return { items, cap, dropped }
}

/**
 * 보여 줄 근거 — 저장은 원문 그대로 두고, 화면 · 도구에서만 표 태그 · 강조 기호를 걷는다.
 * 표 칸 경계는 「 · 」, 줄바꿈 · 연속 공백은 한 칸
 */
export function readableQuote(q: string): string {
  return q
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, " · ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\*\*|__|\\(?=[~*_])/g, "")
    .replace(/[⏎]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s·]+|[\s·]+$/g, "")
}

/** 출처 머리(「[[첨부: 공고문.hwp]]」)의 괄호를 뗀다 */
export const readableSource = (s: string | null) =>
  s ? s.replace(/^\[\[|\]\]$/g, "").trim() || null : null

/** 저장된 JSON → 항목(모양이 다르면 버린다) */
export function readBonusItems(v: unknown): BonusItem[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x) => x && typeof x === "object" && typeof x.label === "string" && typeof x.quote === "string")
    .map((x) => ({
      label: x.label,
      points: typeof x.points === "number" ? x.points : null,
      pointsText: typeof x.pointsText === "string" ? x.pointsText : null,
      condition: typeof x.condition === "string" ? x.condition : null,
      quote: x.quote,
      source: typeof x.source === "string" ? x.source : null,
    }))
}
export function readBonusCap(v: unknown): BonusCap | null {
  if (!v || typeof v !== "object") return null
  const o = v as Record<string, unknown>
  if (typeof o.quote !== "string") return null
  return {
    points: typeof o.points === "number" ? o.points : null,
    text: typeof o.text === "string" ? o.text : o.quote,
    quote: o.quote,
  }
}

// ─── 3. 우리 인증과 맞추기 ───

/**
 * 인증 키 → 이름 표현. 공고의 항목 이름과 우리 인증 이름을 같은 키로 묶는다(「벤처기업 확인」 = 「벤처인증」).
 * 수집기 govgrants/certs.py CERT_PATTERNS 에서 시작해 우리 인증 표에 있는 것을 더했다. 더 좁은 것을 먼저 둔다.
 */
export const CERT_KEYS: readonly (readonly [string, RegExp])[] = [
  ["gg_family", /경기\s*(?:도\s*)?가족\s*친화/],
  ["gg_youth", /경기\s*(?:도\s*)?청년\s*일하기\s*좋은/],
  ["gg_jobs", /(?:경기\s*(?:도\s*)?)?일자리\s*우수\s*기업/],
  ["women", /여성\s*기업(?!\s*(?:종합\s*)?지원\s*센터)/],
  ["disabled", /장애인\s*기업/],
  ["sme", /중소\s*기업\s*확인/],
  // 「중소벤처기업부」 「벤처집적시설」 은 벤처기업 확인이 아니다(2026-11-27 표본 — 동부거점 우대 항목)
  ["venture", /(?<!소셜\s*|중소\s*)벤처(?!\s*(?:캐피탈|투자|펀드|캠퍼스|생태계|협회|집적|빌딩|타운|센터|기업\s*협회|기업\s*육성))/],
  // 「우수기업부설연구소」 는 연구소 인정과 다른 지정이다(2026-11-27 표본 — 재난재해 R&D 가점 2점)
  ["rnd_excellent", /우수\s*기업\s*부설\s*연구소/],
  ["rnd_dept", /기업\s*부설\s*연구소|연구\s*개발\s*전담\s*부서|연구\s*전담\s*부서/],
  ["innobiz", /이노\s*비즈|inno\s*-?\s*biz|기술\s*혁신형\s*중소\s*기업/i],
  ["mainbiz", /메인\s*비즈|main\s*-?\s*biz|경영\s*혁신형\s*중소\s*기업/i],
  ["sobujang", /소재\s*[·ㆍ]?\s*부품\s*[·ㆍ]?\s*장비\s*전문\s*기업|소부장\s*전문\s*기업/],
  ["talent", /인재\s*육성형\s*중소\s*기업/],
  ["family", /가족\s*친화\s*(?:인증|기업)/],
  ["worklife", /일\s*[·ㆍ]?\s*생활\s*균형/],
  ["profit_share", /성과\s*공유\s*(?:기업|도입|제도)/],
  ["youth_sme", /청년\s*(?:친화|일자리)\s*강소\s*기업/],
  ["export_sme", /수출\s*유망\s*중소\s*기업|글로벌\s*강소\s*기업/],
  ["job_creation", /고용\s*창출\s*우수|일자리\s*으뜸\s*기업/],
  ["social", /사회적\s*(?:기업|경제\s*기업)|협동\s*조합/],
  ["senior", /고령자\s*친화\s*기업/],
  ["green", /녹색\s*(?:기술\s*)?인증/],
  ["med_device", /혁신형\s*의료\s*기기\s*기업/],
  ["pharma", /혁신형\s*제약\s*기업/],
  ["esg_field", /ESG\s*분야/i],
  ["esg", /ESG\s*(?:우수|경영\s*우수|확인)/i],
  ["safety", /노동\s*안전\s*보건\s*우수/],
  ["interview_pay", /면접\s*수당/],
  ["std_patent", /표준\s*특허/],
  ["naeil", /내일\s*채움\s*공제/],
  ["pension", /퇴직\s*연금/],
  ["opendata", /open\s*data|오픈\s*데이터/i],
  ["pre_tips", /프리\s*팁스|pre\s*-?\s*tips/i],
  ["non_capital_factory", /비\s*수도권\s*(?:소재\s*)?공장/],
  ["non_capital", /비\s*수도권|지방\s*소재\s*기업/],
]

/** 글에 든 인증 키 전부 — 한 항목이 「벤처 · 이노비즈 · 메인비즈 중 하나」 처럼 여럿을 묶기도 한다 */
export function certKeysOf(s: string): string[] {
  const out: string[] = []
  let rest = s
  for (const [key, rx] of CERT_KEYS) {
    if (rx.test(rest)) {
      out.push(key)
      // 좁은 것(경기도 가족친화)에 걸린 말이 넓은 것(가족친화)에 또 걸리지 않게 걷는다
      rest = rest.replace(new RegExp(rx.source, rx.flags.replace("g", "") + "g"), " ")
    }
  }
  return out
}

export interface OurCert {
  id: string
  name: string
  officialName: string | null
  status: CertStatus
  validUntil: Date | string | null
}

/** 우리 인증 → 키. 이름으로 먼저 보고, 이름에서 안 나오면 공식 이름(설명이 길어 다른 제도 이름이 섞이므로 뒤로) */
export function keyOfCert(c: Pick<OurCert, "name" | "officialName">): string | null {
  return certKeysOf(c.name)[0] ?? (c.officialName ? (certKeysOf(c.officialName)[0] ?? null) : null)
}

export type OurState = "held" | "valid" | "expired" | "none"
export const OUR_STATE_LABEL: Record<OurState, string> = {
  held: "보유",
  valid: "유효기간 안",
  expired: "만료",
  none: "없음",
}
const RANK: Record<OurState, number> = { held: 0, valid: 1, expired: 2, none: 3 }

const ymd = (d: Date | string) =>
  new Date(d).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

/** 기준일(공고 마감, 없으면 오늘)에 이 인증이 어떤가 */
export function stateOf(c: OurCert, ref: Date): { state: OurState; note: string | null } {
  switch (c.status) {
    case "HELD":
      if (!c.validUntil) return { state: "held", note: null }
      return ymd(c.validUntil) >= ymd(ref)
        ? { state: "valid", note: `~ ${ymd(c.validUntil)}` }
        : { state: "expired", note: `${ymd(c.validUntil)} 만료` }
    case "EXPIRED":
      return { state: "expired", note: c.validUntil ? `${ymd(c.validUntil)} 만료` : null }
    case "RENEWAL_DUE":
      return { state: "expired", note: "갱신 필요" }
    case "CANDIDATE":
      return { state: "none", note: "취득 후보" }
    case "NOT_ELIGIBLE":
      return { state: "none", note: "자격 안 됨" }
  }
}

export interface BonusRow extends BonusItem {
  state: OurState
  /** 맞춘 우리 인증 이름 */
  cert: string | null
  note: string | null
  /** 예상 합계에 들어가는가(보유 · 유효기간 안 + 점수가 있음) */
  counted: boolean
}

export interface BonusMatch {
  rows: BonusRow[]
  cap: BonusCap | null
  /** 받을 수 있는 가점 합(상한 적용) */
  expected: number
  /** 공고가 주는 가점 합(상한 적용) — 표의 「최대」 */
  possible: number
  /** 점수를 모르는 항목이 있다 */
  unknownPoints: boolean
}

const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase()
const round = (n: number) => Math.round(n * 100) / 100

/** 공고 가점 항목 × 우리 인증 → 표. 한 항목이 여러 인증을 묶으면 가장 나은 우리 상태를 쓴다 */
export function matchBonus(
  items: BonusItem[],
  cap: BonusCap | null,
  certs: OurCert[],
  ref: Date
): BonusMatch {
  const byKey = new Map<string, OurCert[]>()
  for (const c of certs) {
    const k = keyOfCert(c)
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), c])
  }
  const rows: BonusRow[] = items.map((it) => {
    const keys = certKeysOf(`${it.label} ${it.condition ?? ""}`)
    let found = keys.flatMap((k) => byKey.get(k) ?? [])
    // 키가 없는 항목은 우리 인증 이름이 항목 이름에 통째로 들어 있을 때만 잇는다
    if (!keys.length)
      found = certs.filter((c) => compact(c.name).length >= 4 && compact(it.label).includes(compact(c.name)))
    const best = found
      .map((c) => ({ c, ...stateOf(c, ref) }))
      .sort((a, b) => RANK[a.state] - RANK[b.state])[0]
    const state: OurState = best?.state ?? "none"
    return {
      ...it,
      state,
      cert: best?.c.name ?? null,
      note: best?.note ?? null,
      counted: (state === "held" || state === "valid") && it.points !== null,
    }
  })
  const sum = (rs: BonusRow[]) => round(rs.reduce((a, r) => a + (r.points ?? 0), 0))
  const limit = (n: number) => (cap?.points != null ? Math.min(n, cap.points) : n)
  return {
    rows,
    cap,
    expected: limit(sum(rows.filter((r) => r.counted))),
    possible: limit(sum(rows)),
    unknownPoints: rows.some((r) => r.points === null),
  }
}

/** 점수 한 칸 — 「2점」 「최대 2점」(원문 우선), 모르면 「—」 */
export function pointsLabel(r: Pick<BonusItem, "points" | "pointsText">): string {
  const t = r.pointsText ? readableQuote(r.pointsText) : ""
  if (t) return /^\d+(?:\.\d+)?$/.test(t) ? `${t}점` : t
  return r.points !== null ? `${r.points}점` : "—"
}

/** 도구 · 보고용 글 표 */
export function bonusMatchText(title: string, m: BonusMatch): string {
  if (!m.rows.length) return `${title} — 인증 · 자격 가점 항목이 없습니다.`
  const out = [
    `${title} — 가점 ${m.rows.length}개 · 예상 ${m.expected}점 / 최대 ${m.possible}점${m.cap ? ` (상한: ${m.cap.text})` : ""}${m.unknownPoints ? " · 점수 모르는 항목 있음" : ""}`,
    "| 가점 항목 | 점수 | 우리 상태 | 근거 |",
    "|---|---|---|---|",
  ]
  for (const r of m.rows) {
    const ours = [OUR_STATE_LABEL[r.state], r.cert && r.cert !== r.label ? r.cert : null, r.note].filter(Boolean).join(" · ")
    const cell = (s: string) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim()
    out.push(
      `| ${cell(r.label)}${r.condition ? ` (${cell(r.condition)})` : ""} | ${cell(pointsLabel(r))} | ${cell(ours)} | 「${cell(readableQuote(r.quote)).slice(0, 220)}」${r.source ? ` — ${cell(readableSource(r.source) ?? "")}` : ""} |`
    )
  }
  return out.join("\n")
}
