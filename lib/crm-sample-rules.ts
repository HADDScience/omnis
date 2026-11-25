import { concText, lotText, variantLabel, type GelLot, type GelType } from "@/lib/crm-gel"
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

/**
 * 제품 이름의 다른 이름들(정규화 전) — 「한글 (English)」 이면 전체 · 한글 · English. 목록 줄(list_products)의 별칭 칸이 쓴다.
 * 고르기는 위 productNames(핫픽스 #237)가 한다.
 */
export function productNameVariants(name: string): string[] {
  const outside = name.replace(/\s*[(（][^)）]*[)）]\s*/g, " ").trim()
  const inside = [...name.matchAll(/[(（]([^)）]+)[)）]/g)].map((m) => m[1].trim())
  return [...new Set([name, outside, ...inside].filter(Boolean))]
}

/** 말로 적은 단위를 규격 표기로 — 「2미리」 「2밀리」 「2㎖」 「2 mL」 → 2ml */
export function normalizeUnits(s: string): string {
  return s.replace(/(\d)\s*(미리리터|밀리리터|미리|밀리|㎖|ml)/gi, "$1ml").replace(/(\d)\s*(그램|그람|g)\b/gi, "$1g")
}

/** 제품 고르기 — 「이름 규격」 이 같으면 그것, 이름만 맞으면 규격이 하나일 때만 */
export function pickProduct<T extends ProductLike>(query: string, products: T[]):
  | { kind: "one"; product: T }
  | { kind: "many"; candidates: T[] }
  | { kind: "none" } {
  const q = normalizeOrgName(normalizeUnits(query))
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

export interface ProductRow extends ProductLike {
  id: string
  code: string
  /** 현재고(장부 IN − OUT). 젤 타입은 모든 농도의 총 ml */
  stock: number
  unit: "PIECE" | "GRAM" | "ML"
  /** 젤 타입(애드젤 · 라이브젤)이면 타입, 아니면 null — 재고는 lots(농도별)로 본다 */
  gelType?: GelType | null
  lots?: GelLot[]
}

const unitText = (qty: number, unit: ProductRow["unit"]) =>
  unit === "GRAM" ? `${Number(qty.toFixed(3))}g` : unit === "ML" ? `${Number(qty.toFixed(3))}ml` : `${qty}개`

/** list_products 한 줄 — AI 가 여기서 product_id 를 골라 record_sample 에 넣는다 */
export function productListLine(p: ProductRow): string {
  const alias = productNameVariants(p.name).slice(2)
  const head = [
    `- product_id=${p.id}`,
    p.code,
    p.name,
    alias.length ? `별칭 ${alias.join(", ")}` : null,
  ]
  if (p.gelType) {
    const lots = (p.lots ?? []).filter((l) => l.ml !== 0)
    return [
      [...head, "젤 타입 — 농도(concentration) · ml(volume_ml)를 함께 준다. 개수는 세지 않는다", `재고 합계 ${unitText(p.stock, "ML")}`].filter(Boolean).join(" · "),
      ...(lots.length ? lots.map((l) => `  · 농도 ${l.conc === 0 ? "(빈 칸)" : concText(l.conc)}: ${lotText(l)}`) : ["  · 농도별 재고 없음"]),
    ].join("\n")
  }
  return [...head, `규격 ${p.spec ?? "-"}`, `재고 ${unitText(p.stock, p.unit)}`].filter(Boolean).join(" · ")
}

/**
 * record_sample 의 제품 정하기 — product_id(또는 코드)가 있으면 그것만 본다(이름은 무시).
 * 없으면 이름 맞추기(pickProduct). 여럿이면 id 와 함께 후보를 돌려줘 AI 가 사용자에게 묻고 product_id 로 다시 부르게 한다.
 */
export function resolveProduct<T extends ProductLike & { id: string; code: string }>(
  v: Pick<SampleArgs, "productId" | "product">,
  products: T[],
): { product: T | null } | { problem: string } {
  if (v.productId) {
    const key = v.productId.trim()
    const hit = products.find((p) => p.id === key || p.code.toUpperCase() === key.toUpperCase())
    return hit ? { product: hit } : { problem: `product_id '${key}' 인 제품이 CRM 에 없습니다. list_products 로 목록을 보고 다시 고르세요.` }
  }
  if (!v.product) return { product: null }
  const p = pickProduct(v.product, products)
  if (p.kind === "one") return { product: p.product }
  if (p.kind === "many") {
    return { problem: `'${v.product}' 에 제품이 여럿 걸립니다: ${p.candidates.map((c) => `${productLabel(c)}(product_id=${c.id})`).join(" / ")}. 규격까지 적어 다시 부르세요 — 어느 것인지 애매하면 사용자에게 후보를 보여 주고 물은 뒤 product_id 로 부릅니다.` }
  }
  // 앞 문장은 예전 답 그대로(바깥 MCP 클라이언트가 볼 수 있다) — list_products 안내만 더했다
  return { problem: `'${v.product}' 제품이 CRM 제품 목록에 없습니다. 목록에 있는 이름으로 다시 부르거나, 제품 없이 content 에 적어 남기세요. list_products 로 목록을 보고 product_id 로 부르면 정확합니다.` }
}

/** 젤 타입이면 「애드젤 (ADD GEL) · 1% · 5ml」, 아니면 이름 규격 */
export function variantProductLabel(p: ProductLike & { gelType?: GelType | null }, conc?: number | null, volumeMl?: number | null): string {
  return p.gelType ? variantLabel(p.name, conc ?? null, volumeMl ?? null) : productLabel(p)
}

/** 출고 뒤 재고 경고 — 0 이 되거나 모자라면 */
export function stockWarning(before: number, quantity: number, unit: ProductRow["unit"] = "PIECE"): string | null {
  const after = Math.round((before - quantity) * 1000) / 1000
  if (after < 0) return `재고가 모자랍니다 — 지금 ${unitText(before, unit)}인데 ${unitText(quantity, unit)}를 빼면 ${unitText(after, unit)}가 됩니다. 장부가 맞는지 확인하세요.`
  if (after === 0) return `출고하면 이 제품 재고가 0 이 됩니다(지금 ${unitText(before, unit)}).`
  return null
}

export const stockText = unitText

const ORG_TYPES = ["UNIVERSITY", "RESEARCH", "COMPANY", "HOSPITAL", "OTHER"] as const
export type OrgTypeArg = (typeof ORG_TYPES)[number]

export interface SampleArgs {
  org: string
  /** CRM 제품 id(또는 코드 PRD001) — list_products 에서 고른 것. 있으면 이름보다 먼저 쓴다 */
  productId: string | null
  product: string | null
  quantity: number | null
  /** 젤 타입이면 농도(%) · 보낸 ml — 검사는 제품을 고른 뒤(planSampleDelivery) */
  concentration: unknown
  volumeMl: unknown
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
  const productId = str(args.product_id).slice(0, 64) || null
  let quantity: number | null = null
  if (args.quantity !== undefined && args.quantity !== null && String(args.quantity).trim() !== "") {
    const n = Number(args.quantity)
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "quantity 는 1 이상의 정수입니다." }
    if (n > 10000) return { ok: false, error: "quantity 가 너무 큽니다(10000 초과) — 단위를 확인하세요." }
    quantity = n
  }
  if (quantity !== null && !product && !productId) return { ok: false, error: "수량을 적으려면 product_id(또는 product)가 필요합니다." }
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
      productId,
      product,
      quantity,
      concentration: args.concentration ?? null,
      volumeMl: args.volume_ml ?? null,
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
export function sampleRequestText(v: Pick<SampleArgs, "content">, product: (ProductLike & { label?: string }) | null, quantity: number | null): string {
  if (v.content) return v.content
  if (product) return `${product.label ?? productLabel(product)}${quantity ? ` ${quantity}개` : ""} 샘플 전달`
  return "샘플 전달"
}
