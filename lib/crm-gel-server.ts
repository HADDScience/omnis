// CRM 젤 타입 재고 — DB 를 읽는 쪽. 규칙(합산 · 차감 · 범위)은 lib/crm-gel.ts.
import { prisma } from "@/lib/db"
import { gelLots, isGelType, MATERIAL_MAP_KEY, resolveMaterial, round3, type GelLot, type GelType } from "@/lib/crm-gel"

export interface GelProductRow {
  id: string
  code: string
  name: string
  gelType: GelType
}

/** 타입 제품 두 줄(애드젤 · 라이브젤). 옮기기 마이그레이션 전이면 빈 배열 */
export async function gelProducts(): Promise<GelProductRow[]> {
  const rows = await prisma.crmProduct.findMany({
    where: { gelType: { not: null }, archived: false },
    select: { id: true, code: true, name: true, gelType: true },
    orderBy: { code: "asc" },
  })
  return rows.filter((r) => isGelType(r.gelType)).map((r) => ({ ...r, gelType: r.gelType as GelType }))
}

/** 젤 타입 제품마다 농도별 재고 */
export async function gelLotsByProduct(productIds?: string[]): Promise<Map<string, GelLot[]>> {
  const ids = productIds ?? (await gelProducts()).map((p) => p.id)
  if (ids.length === 0) return new Map()
  const moves = await prisma.crmStockMove.findMany({
    where: { productId: { in: ids } },
    select: { productId: true, direction: true, quantity: true, concentrationPct: true },
  })
  const out = new Map<string, GelLot[]>()
  for (const id of ids) out.set(id, gelLots(moves.filter((m) => m.productId === id)))
  return out
}

/** 원료 목록 + 현재고(g) */
export async function materialsWithStock(): Promise<{ id: string; code: string; name: string; grams: number }[]> {
  const mats = await prisma.crmProduct.findMany({
    where: { isMaterial: true, archived: false, stockUnit: "GRAM" },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })
  if (mats.length === 0) return []
  const sums = await prisma.crmStockMove.groupBy({ by: ["productId", "direction"], where: { productId: { in: mats.map((m) => m.id) } }, _sum: { quantity: true } })
  const bal = new Map<string, number>()
  for (const s of sums) bal.set(s.productId, (bal.get(s.productId) ?? 0) + Number(s._sum.quantity ?? 0) * (s.direction === "IN" ? 1 : -1))
  return mats.map((m) => ({ ...m, grams: round3(bal.get(m.id) ?? 0) }))
}

/** AppSetting 의 타입별 원재료 매핑 — 없거나 깨졌으면 null(기본 규칙: 원료가 하나면 그것) */
export async function materialMapSetting(): Promise<Partial<Record<GelType, string | null>> | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: MATERIAL_MAP_KEY } }).catch(() => null)
  if (!row) return null
  const v = row.value
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const out: Partial<Record<GelType, string | null>> = {}
  for (const [k, ref] of Object.entries(v as Record<string, unknown>)) if (isGelType(k)) out[k] = typeof ref === "string" && ref ? ref : null
  return out
}

/** 이 타입의 원재료(+ 현재고) — 정해지지 않으면 null */
export async function materialForGel(gel: GelType) {
  const [mats, setting] = await Promise.all([materialsWithStock(), materialMapSetting()])
  const m = resolveMaterial(gel, setting, mats)
  return m ? mats.find((x) => x.id === m.id) ?? null : null
}
