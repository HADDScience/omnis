// CRM 젤 타입 재고 — 순수 함수(DB 를 읽지 않는다. 단위 시험이 DB 없이 돈다).
//
// 2026-11-25 결정: 젤 제품은 규격(용량)마다 행을 두지 않고 타입 둘(애드젤 · 라이브젤)로 고정한다.
// 재고 칸은 (타입, 농도 %) 이고, 같은 칸은 총 ml 로 더한다. 개수는 세지 않는다 — 재고 · 생산 · 출고 · 샘플 · 실사 모두 ml 만 쓴다(11/25 2차).
// 세트 · 동결건조 같은 구성품도 따로 두지 않고 단품(농도 · ml)으로 센다.
// 농도는 0.5 ~ 20%, ml 는 양수면 아무 값이나 된다.

export const GEL_TYPES = ["ADDGEL", "LIVEGEL"] as const
export type GelType = (typeof GEL_TYPES)[number]

export const GEL_TYPE_LABEL: Record<GelType, string> = {
  ADDGEL: "애드젤 (ADD GEL)",
  LIVEGEL: "라이브젤 (LiVEGEL)",
}

export const CONC_MIN = 0.5
export const CONC_MAX = 20

/** 자주 쓰는 값 — 생산 팝업의 버튼. 데이터(지난 규격)에서 나온 값과 노혜린 과장님 요청(10% 5ml)을 담았다 */
export const FREQUENT_CONC: Record<GelType, number[]> = {
  ADDGEL: [1, 2, 5, 10],
  LIVEGEL: [0.74, 1, 2],
}
export const FREQUENT_ML = [1, 2, 3, 5, 10, 20, 50]

export const round3 = (n: number) => Math.round(n * 1000) / 1000

export const isGelType = (v: unknown): v is GelType => typeof v === "string" && (GEL_TYPES as readonly string[]).includes(v)

/** 농도 검사 — 숫자로 바꾸고 소수 셋째 자리로 맞춘다(DB 칸이 Decimal(6,3)) */
export function parseConc(v: unknown): { conc: number } | { problem: string } {
  const n = typeof v === "string" ? Number(v.replace(/\s*(wt)?\s*%\s*$/i, "")) : Number(v)
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return { problem: "농도(%)를 숫자로 적어 주세요." }
  const c = round3(n)
  if (c < CONC_MIN || c > CONC_MAX) return { problem: `농도는 ${CONC_MIN} ~ ${CONC_MAX}% 사이입니다(받은 값 ${c}%).` }
  return { conc: c }
}

/** ml 검사 — 양수면 된다 */
export function parseMl(v: unknown): { ml: number } | { problem: string } {
  const n = typeof v === "string" ? Number(v.replace(/\s*ml\s*$/i, "")) : Number(v)
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return { problem: "ml 를 숫자로 적어 주세요." }
  const m = round3(n)
  if (m <= 0) return { problem: "ml 는 0보다 커야 합니다." }
  if (m > 100000) return { problem: "ml 가 너무 큽니다 — 단위를 확인해 주세요." }
  return { ml: m }
}

/**
 * 원재료 차감량(g). 농도 % 는 g/100ml(w/v)로 본다 — 10% 젤 1ml 에는 원재료 0.1g 이 든다.
 * 그래서 차감량 = 농도/100 × ml 이고, 밀도를 따로 곱하지 않는다(11/25 2차 결정).
 */
export const gelMaterialGrams = (conc: number, ml: number) => round3((conc / 100) * ml)

export const fmtNum = (n: number) => `${Number(round3(n).toFixed(3))}`
export const mlText = (n: number) => `${fmtNum(n)}ml`
export const concText = (n: number) => `${fmtNum(n)}%`

/** 「애드젤 (ADD GEL) · 1% · 5ml」 — ml 를 모르면 농도까지만 */
export function variantLabel(name: string, conc: number | null | undefined, volumeMl?: number | null): string {
  return [name, conc != null ? concText(conc) : null, volumeMl != null ? mlText(volumeMl) : null].filter(Boolean).join(" · ")
}

// ─── 장부 → 재고 칸 ───────────────────────────────────────────────

export interface GelMove {
  direction: "IN" | "OUT"
  /** 총 ml */
  quantity: number | { toString(): string }
  concentrationPct: number | { toString(): string } | null
}

export interface GelLot {
  conc: number
  /** 총 ml(IN − OUT) */
  ml: number
  inMl: number
  outMl: number
}

/**
 * 한 젤 타입의 장부 줄 → 농도별 재고. 농도가 빈 줄(옮기기 전 · 잘못 적힌 줄)은 conc = 0 칸에 모아
 * 숨기지 않고 드러낸다 — 빼 버리면 합이 조용히 틀어진다.
 */
export function gelLots(moves: GelMove[]): GelLot[] {
  const lots = new Map<number, { inMl: number; outMl: number }>()
  for (const m of moves) {
    const conc = round3(m.concentrationPct == null ? 0 : Number(m.concentrationPct))
    const lot = lots.get(conc) ?? { inMl: 0, outMl: 0 }
    const ml = Number(m.quantity)
    if (m.direction === "IN") lot.inMl += ml
    else lot.outMl += ml
    lots.set(conc, lot)
  }
  return [...lots.entries()]
    .map(([conc, l]) => ({ conc, inMl: round3(l.inMl), outMl: round3(l.outMl), ml: round3(l.inMl - l.outMl) }))
    .sort((a, b) => a.conc - b.conc)
}

export const lotOf = (lots: GelLot[], conc: number) => lots.find((l) => l.conc === round3(conc)) ?? null
export const lotMl = (lots: GelLot[], conc: number) => lotOf(lots, conc)?.ml ?? 0

/** 「25ml」 — 칸이 없으면 0ml */
export const lotText = (lot: GelLot | null) => mlText(lot?.ml ?? 0)

/** 빼고 나면 모자라는가 — 경고 문구(막지는 않는다) */
export function gelShortWarning(label: string, before: number, takeMl: number): string | null {
  const after = round3(before - takeMl)
  if (after < 0) return `${label} 재고가 모자랍니다 — 지금 ${mlText(before)}인데 ${mlText(takeMl)}를 빼면 ${mlText(after)}가 됩니다. 기록은 남깁니다.`
  if (after === 0) return `${label} 재고가 0ml 이 됩니다(지금 ${mlText(before)}).`
  return null
}

/** 원재료가 모자랄 때 — 기록은 막지 않는다 */
export function materialShortWarning(name: string, before: number, takeGrams: number): string | null {
  const after = round3(before - takeGrams)
  if (after < 0) return `원재료 ${name} 가 모자랍니다 — 지금 ${fmtNum(before)}g 인데 ${fmtNum(takeGrams)}g 를 빼면 ${fmtNum(after)}g 가 됩니다. 기록은 남기니 원료 입고를 확인해 주세요.`
  return null
}

// ─── 원재료 매핑 ─────────────────────────────────────────────────

/** AppSetting 키 — {"ADDGEL": "<원료 제품 id 또는 코드>", "LIVEGEL": …}. 값이 null 이면 차감하지 않는다 */
export const MATERIAL_MAP_KEY = "crm_gel_material_map"

/**
 * 타입별 원재료. 설정이 없으면 원료(isMaterial · g 단위 · 숨김 아님)가 하나뿐일 때 그것을 쓴다 — 지금 운영은 DNA 하나다.
 * 원료가 여럿인데 설정이 없으면 고르지 않는다(지어내지 않는다).
 */
export function resolveMaterial(
  gel: GelType,
  setting: Partial<Record<GelType, string | null>> | null,
  materials: { id: string; code: string; name: string }[],
): { id: string; code: string; name: string } | null {
  if (setting && gel in setting) {
    const ref = setting[gel]
    if (!ref) return null
    return materials.find((m) => m.id === ref || m.code === ref) ?? null
  }
  return materials.length === 1 ? materials[0] : null
}

/**
 * 기록 한 줄(출고 · 견적 품목 · 샘플 · 장부)의 제품 이름 — 젤 타입이면 그 줄의 농도 · ml 를 붙인다.
 * 젤이 아니면 「이름 규격」(지난 방식 그대로).
 */
export function rowProductLabel(
  product: { name: string; spec?: string | null; gelType?: string | null },
  row?: { concentrationPct?: unknown; volumeMl?: unknown } | null,
): string {
  const n = (v: unknown) => (v == null || v === "" ? null : Number(v))
  if (product.gelType) return variantLabel(product.name, n(row?.concentrationPct), n(row?.volumeMl))
  return `${product.name}${product.spec ? ` ${product.spec}` : ""}`
}

/** 출고 · 샘플 출고 한 줄의 양 — 젤 타입은 ml(개수를 세지 않는다), 아니면 개 */
export function amountText(row: { quantity?: number | null; volumeMl?: unknown }, gelType?: string | null): string {
  if (gelType) return mlText(row.volumeMl == null || row.volumeMl === "" ? 0 : Number(row.volumeMl))
  return `${row.quantity ?? 0}개`
}
