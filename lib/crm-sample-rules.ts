// 샘플 전달 기록 · 기관 찾기 — DB 없이 시험하는 규칙. 서버 쪽은 lib/crm-sample-server.ts.
//
// 기능 요청(#231): 「거래처에 샘플을 전달했다」 고 말했는데 find_org 가 기관을 못 찾았다.
// 이름에 붙는 법인 표기 · 띄어쓰기가 사람마다 달라 contains 한 번으로는 놓친다.

/** 법인 표기 — 기관 이름을 맞춰 볼 때 뺀다. 「(주)」 는 괄호까지 지운 뒤 남는 「주」 를 다시 못 찾으니 통째로 먼저 뺀다 */
const CORP_MARKS = /\(주\)|㈜|주식회사|\(유\)|유한회사|\(재\)|재단법인|\(사\)|사단법인|\(학\)|학교법인|\(의\)|의료법인|\bco\.,?\s*ltd\b\.?|\binc\b\.?|\bltd\b\.?|\bcorp\b\.?/gi

/** 맞춰 보기용 이름 — 소문자 · 법인 표기 · 띄어쓰기 · 문장부호를 뺀다 */
export function normalizeOrgName(s: string): string {
  return s
    .toLowerCase()
    .replace(CORP_MARKS, "")
    .replace(/[\s·.,\-_/()（）[\]{}"'`~]/g, "")
}

export interface OrgLike {
  name: string
  code: string
}

/**
 * 이름 · 코드로 기관을 고른다. 점수가 높은 것부터.
 *   3 — 정규화한 이름이 같다 · 코드가 같다
 *   2 — 이름이 검색어를 품는다 (「서울대」 → 「서울대학교」)
 *   1 — 검색어가 이름을 품는다 (「서울대학교 의과대학 ○○교수님」 → 「서울대학교」) · 낱말이 모두 이름에 있다
 * 두 글자 미만은 맞춰 보지 않는다 — 한 글자는 거의 모든 기관에 걸린다.
 */
export function rankOrgs<T extends OrgLike>(query: string, orgs: T[]): { org: T; score: number }[] {
  const q = normalizeOrgName(query)
  if (q.length < 2) return []
  const words = query.split(/\s+/).map(normalizeOrgName).filter((w) => w.length >= 2)
  const out: { org: T; score: number }[] = []
  for (const org of orgs) {
    const n = normalizeOrgName(org.name)
    const code = org.code.toLowerCase()
    let score = 0
    if (n === q || code === query.trim().toLowerCase()) score = 3
    else if (n.includes(q) || code.includes(q)) score = 2
    else if ((n.length >= 2 && q.includes(n)) || (words.length > 1 && words.every((w) => n.includes(w)))) score = 1
    if (score > 0) out.push({ org, score })
  }
  return out.sort((a, b) => b.score - a.score || a.org.name.length - b.org.name.length)
}

/**
 * 하나로 정할 수 있나. 같은 이름(3점)이 하나면 그것, 아니면 후보가 하나뿐일 때만.
 * 「서울」 처럼 여럿 걸리면 고르지 않는다 — 엉뚱한 기관에 샘플 내역이 붙으면 아무도 모른다.
 */
export function pickOrg<T extends OrgLike>(ranked: { org: T; score: number }[]):
  | { kind: "one"; org: T }
  | { kind: "many"; candidates: T[] }
  | { kind: "none" } {
  if (ranked.length === 0) return { kind: "none" }
  const exact = ranked.filter((r) => r.score === 3)
  if (exact.length === 1) return { kind: "one", org: exact[0].org }
  if (ranked.length === 1) return { kind: "one", org: ranked[0].org }
  return { kind: "many", candidates: (exact.length > 1 ? exact : ranked).slice(0, 5).map((r) => r.org) }
}

export interface ProductLike {
  name: string
  spec: string | null
}

/**
 * 제품 이름의 여러 부름 — 「애드젤 (ADD Gel)」 이면 전체 · 「애드젤」 · 「ADD Gel」.
 * 사람은 괄호 별칭 없이 한쪽 이름만 말한다.
 */
function productNames(name: string): string[] {
  const aliases = [...name.matchAll(/[(（]([^()（）]+)[)）]/g)].map((m) => m[1])
  const base = name.replace(/[(（][^()（）]*[)）]/g, " ")
  return [...new Set([name, base, ...aliases].map(normalizeOrgName).filter(Boolean))]
}

/** 제품 고르기 — 「이름 규격」 이 같으면 그것, 이름만 맞으면 규격이 하나일 때만 */
export function pickProduct<T extends ProductLike>(query: string, products: T[]):
  | { kind: "one"; product: T }
  | { kind: "many"; candidates: T[] }
  | { kind: "none" } {
  const q = normalizeOrgName(query)
  if (!q) return { kind: "none" }
  const spec = (p: T) => normalizeOrgName(p.spec ?? "")
  const full = products.filter((p) => productNames(p.name).some((n) => n + spec(p) === q))
  if (full.length === 1) return { kind: "one", product: full[0] }
  const byName = products.filter((p) => productNames(p.name).includes(q))
  if (byName.length === 1) return { kind: "one", product: byName[0] }
  const loose = byName.length ? byName : products.filter((p) => productNames(p.name).some((n) => (n + spec(p)).includes(q)))
  if (loose.length === 1) return { kind: "one", product: loose[0] }
  if (loose.length > 1) return { kind: "many", candidates: loose.slice(0, 8) }
  return { kind: "none" }
}

export const productLabel = (p: ProductLike) => `${p.name}${p.spec ? ` ${p.spec}` : ""}`

const ORG_TYPES = ["UNIVERSITY", "RESEARCH", "COMPANY", "HOSPITAL", "OTHER"] as const
export type OrgTypeArg = (typeof ORG_TYPES)[number]

export interface SampleArgs {
  org: string
  product: string | null
  quantity: number | null
  /** YYYY-MM-DD — 전달한 날 */
  date: string
  contact: string | null
  content: string | null
  referral: string | null
  note: string | null
  createOrg: boolean
  orgType: OrgTypeArg
  confirm: boolean
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

/** 오늘(서울) YYYY-MM-DD */
export const kstToday = (now = new Date()) => now.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

/** 도구 입력 → 검사한 값. 실패하면 사람이 고칠 수 있는 말로 */
export function parseSampleArgs(args: Record<string, unknown>, now = new Date()): { ok: true; value: SampleArgs } | { ok: false; error: string } {
  const org = str(args.org)
  if (!org) return { ok: false, error: "org(기관 이름)가 비어 있습니다." }
  const product = str(args.product) || null
  let quantity: number | null = null
  if (args.quantity !== undefined && args.quantity !== null && String(args.quantity).trim() !== "") {
    const n = Number(args.quantity)
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "quantity 는 1 이상의 정수입니다." }
    if (n > 10000) return { ok: false, error: "quantity 가 너무 큽니다(10000 초과) — 단위를 확인하세요." }
    quantity = n
  }
  if (quantity !== null && !product) return { ok: false, error: "수량을 적으려면 product(제품)가 필요합니다." }
  const today = kstToday(now)
  const date = str(args.date) || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return { ok: false, error: "date 는 YYYY-MM-DD 입니다." }
  // 전달한 일을 적는 도구다 — 앞날은 계획이지 전달 내역이 아니다
  if (date > today) return { ok: false, error: `date(${date})가 오늘(${today}) 뒤입니다. 전달한 날을 적으세요.` }
  const type = str(args.org_type).toUpperCase()
  if (type && !(ORG_TYPES as readonly string[]).includes(type)) return { ok: false, error: `org_type 은 ${ORG_TYPES.join(" · ")} 중 하나입니다.` }
  const clip = (v: unknown, n: number) => str(v).slice(0, n) || null
  return {
    ok: true,
    value: {
      org: org.slice(0, 200),
      product,
      quantity,
      date,
      contact: clip(args.contact, 100),
      content: clip(args.content, 2000),
      referral: clip(args.referral, 200),
      note: clip(args.note, 2000),
      createOrg: args.create_org === true,
      orgType: (type || "OTHER") as OrgTypeArg,
      confirm: args.confirm === true,
    },
  }
}

/** 샘플요청 칸 「요청사항」 에 들어갈 말 — 사용자가 준 말이 없으면 제품 · 수량으로 */
export function sampleRequestText(v: Pick<SampleArgs, "content">, product: ProductLike | null, quantity: number | null): string {
  if (v.content) return v.content
  if (product) return `${productLabel(product)}${quantity ? ` ${quantity}개` : ""} 샘플 전달`
  return "샘플 전달"
}
