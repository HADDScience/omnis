// CRM 쓰기 — 화면 API(app/api/crm/*)와 AI 도구(lib/crm-write-tools.ts)가 같이 부르는 서버 함수.
//
// 라우트 안에 있던 검증 · 중복 검사 · 재고 계산을 그대로 옮겼다. 라우트는 인증 · JSON 읽기 · 응답 모양만 맡는다.
// 그래서 AI 로 고쳐도 화면에서 고친 것과 같은 규칙을 지난다(#crm-write).
import { z } from "zod"
import { prisma } from "@/lib/db"
import { CrmQuoteStatus, CrmSampleStatus, CrmShipmentKind, CrmShipmentStatus, Prisma } from "@/generated/prisma"
import { billingOrgProblem, contactCreateSchema, nextCode, nextDatedCode, orgCreateSchema, orgUpdateSchema, quoteCreateSchema, quoteTotals } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import { createNotification } from "@/lib/notifications"
import { receivableChains, SETTLE_NOTE } from "@/lib/crm-receivables"
import { inquiryAcceptSchema, inquiryRejectSchema } from "@/lib/website-inquiry"
import { writeActivity } from "@/lib/api"
import {
  GEL_TYPES, gelLots, gelMaterialGrams, lotMl, materialShortWarning,
  parseConc, parseMl, round3, variantLabel, type GelType,
} from "@/lib/crm-gel"
import { gelProducts, materialForGel, materialsWithStock } from "@/lib/crm-gel-server"

export type OpResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number; extra?: Record<string, unknown> }

const fail = (error: string, status = 400, extra?: Record<string, unknown>) => ({ ok: false as const, error, status, extra })
const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "잘못된 입력"

type Tx = Prisma.TransactionClient

// ─── 기관 ───────────────────────────────────────────────────────────

export async function createOrg(input: unknown): Promise<OpResult<Prisma.CrmOrgGetPayload<object>>> {
  const parsed = orgCreateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const dup = await prisma.crmOrg.findUnique({ where: { name: parsed.data.name } })
  if (dup) return fail("같은 이름의 기관이 이미 있습니다", 409, { org: dup })
  const org = await createWithUniqueCode(async () => {
    const codes = (await prisma.crmOrg.findMany({ select: { code: true } })).map((o) => o.code)
    return prisma.crmOrg.create({ data: { ...parsed.data, code: nextCode("ORG", codes) } })
  })
  return { ok: true, value: org }
}

export async function updateOrg(orgId: string, input: unknown): Promise<OpResult<Prisma.CrmOrgGetPayload<object>>> {
  const parsed = orgUpdateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const exists = await prisma.crmOrg.findUnique({ where: { id: orgId }, select: { id: true } })
  if (!exists) return fail("기관을 찾을 수 없습니다", 404)
  const { billingOrgId, name } = parsed.data
  if (billingOrgId) {
    const [target, billed] = await Promise.all([
      prisma.crmOrg.findUnique({ where: { id: billingOrgId }, select: { id: true, billingOrgId: true } }),
      prisma.crmOrg.count({ where: { billingOrgId: orgId } }),
    ])
    const problem = billingOrgProblem(orgId, target, billed > 0)
    if (problem) return fail(problem)
  }
  if (name) {
    const dup = await prisma.crmOrg.findUnique({ where: { name }, select: { id: true } })
    if (dup && dup.id !== orgId) return fail("같은 이름의 기관이 이미 있습니다", 409)
  }
  const org = await prisma.crmOrg.update({ where: { id: orgId }, data: parsed.data })
  return { ok: true, value: org }
}

// ─── 재고 장부 ───────────────────────────────────────────────────────

export const stockMoveSchema = z.object({
  movedAt: z.coerce.date(),
  productId: z.string().uuid(),
  direction: z.enum(["IN", "OUT"]),
  /** 젤 타입은 ml */
  quantity: z.number().positive("수량은 0보다 커야 합니다"),
  note: z.string().trim().max(500).optional().nullable(),
  /** 젤 타입 제품이면 필수 — 어느 농도 칸인가 */
  concentrationPct: z.union([z.number(), z.string()]).optional().nullable(),
})

/** 젤 타입 제품의 농도 · ml 칸 — 젤이 아니면 빈 칸. 출고 · 견적 · 샘플이 같은 검사를 쓴다(출고 · 샘플은 총 ml, 견적은 한 개 용량) */
export function gelVariant(
  product: { gelType: string | null; name: string },
  v: { concentrationPct?: unknown; volumeMl?: unknown },
  opts: { needVolume: boolean },
): { ok: true; conc: number | null; volumeMl: number | null } | { ok: false; error: string } {
  if (!product.gelType) return { ok: true, conc: null, volumeMl: null }
  const c = parseConc(v.concentrationPct)
  if ("problem" in c) return { ok: false, error: `${product.name}: ${c.problem}` }
  if (v.volumeMl === undefined || v.volumeMl === null || v.volumeMl === "") {
    if (opts.needVolume) return { ok: false, error: `${product.name}: ml 를 적어 주세요.` }
    return { ok: true, conc: c.conc, volumeMl: null }
  }
  const m = parseMl(v.volumeMl)
  if ("problem" in m) return { ok: false, error: `${product.name}: ${m.problem}` }
  return { ok: true, conc: c.conc, volumeMl: m.ml }
}

/** 재고 장부에 한 줄 직접 적는다 — 원료 입고, 폐기, 실사 보정 같은 것. 젤 타입이면 농도 칸에 ml 로 적는다 */
export async function createStockMove(input: unknown): Promise<OpResult<Prisma.CrmStockMoveGetPayload<object>>> {
  const parsed = stockMoveSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { productId, concentrationPct, ...rest } = parsed.data
  const product = await prisma.crmProduct.findUnique({ where: { id: productId } })
  if (!product) return fail("품목을 찾을 수 없습니다", 404)
  const g = gelVariant(product, { concentrationPct }, { needVolume: false })
  if (!g.ok) return fail(g.error)
  const move = await prisma.crmStockMove.create({
    data: {
      ...rest,
      ...(g.conc != null ? { quantity: round3(rest.quantity) } : {}),
      note: rest.note ?? null,
      ...(g.conc != null ? { concentrationPct: g.conc } : {}),
      product: { connect: { id: productId } },
    },
  })
  return { ok: true, value: move }
}

/** 장부 한 줄 지우기. 생산·출고에서 파생된 줄은 그쪽에서 지워야 한다. */
export async function deleteStockMove(id: string): Promise<OpResult<{ ok: true }>> {
  const move = await prisma.crmStockMove.findUnique({ where: { id } })
  if (!move) return fail("찾을 수 없습니다", 404)
  if (move.productionId || move.shipmentId) return fail("생산·출고에서 나온 줄입니다. 생산 목록 · 출고에서 그 기록을 고치거나 지우면 함께 바뀝니다")
  await prisma.crmStockMove.delete({ where: { id } })
  return { ok: true, value: { ok: true } }
}

// ─── 생산 ───────────────────────────────────────────────────────────
//
// 2026-11-25: 생산은 젤 타입(애드젤 · 라이브젤) 단위로 적는다 — 타입 → 농도 → ml → 날짜 · 메모 · 사진. 개수는 세지 않는다.
// 재고 장부에는 완제품 IN(ml) 한 줄, 원재료 OUT(농도/100 × ml, 농도는 g/100ml) 한 줄이 생긴다.
// 고치면 그 생산에서 나온 장부 줄을 다시 만들고(재고 · 원재료 차감이 다시 계산된다), 지우면 함께 사라진다(되돌림).

export const productionSchema = z.object({
  producedAt: z.coerce.date(),
  /** 젤 타입 제품 id(또는 gelType 으로) */
  productId: z.string().uuid().optional(),
  gelType: z.enum(GEL_TYPES).optional(),
  concentrationPct: z.union([z.number(), z.string()]),
  /** 만든 양(ml) */
  totalMl: z.union([z.number(), z.string()]),
  /** 원재료를 바꿀 때만. 비우면 타입별 매핑(설정) — 'none' 이면 차감하지 않는다 */
  materialId: z.union([z.string().uuid(), z.literal("none")]).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  photoFileIds: z.array(z.string().uuid()).max(10, "사진은 10장까지입니다").optional(),
})

export interface ProductionPlanValue {
  product: { id: string; code: string; name: string; gelType: GelType }
  conc: number
  totalMl: number
  material: { id: string; code: string; name: string; grams: number } | null
  materialGrams: number
  /** 지금 그 농도 재고(ml) — 고치기면 이 생산분을 뺀 값 */
  lotBeforeMl: number
  warnings: string[]
}

/**
 * 생산 입력을 읽고 계산한다(쓰지 않는다) — 화면 미리보기 · AI 확인 카드 · 실제 쓰기가 같은 답을 본다.
 * excludeProductionId: 고치기일 때 그 생산이 만든 장부 줄은 빼고 본다.
 */
export async function planProductionInput(input: unknown, excludeProductionId?: string): Promise<OpResult<ProductionPlanValue & { producedAt: Date; note: string | null; photoFileIds: string[] }>> {
  const parsed = productionSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const d = parsed.data
  const gels = await gelProducts()
  const product = d.productId ? gels.find((g) => g.id === d.productId) : d.gelType ? gels.find((g) => g.gelType === d.gelType) : undefined
  if (!product) return fail(d.productId ? "젤 타입 제품(애드젤 · 라이브젤)만 생산을 적을 수 있습니다" : "제품 타입(애드젤 · 라이브젤)을 골라 주세요", 400)
  const c = parseConc(d.concentrationPct)
  if ("problem" in c) return fail(c.problem)
  const m = parseMl(d.totalMl)
  if ("problem" in m) return fail(`만든 양: ${m.problem}`)
  const totalMl = m.ml

  let material: ProductionPlanValue["material"] = null
  if (d.materialId === "none") material = null
  else if (d.materialId) {
    const mats = await materialsWithStock()
    material = mats.find((m) => m.id === d.materialId) ?? null
    if (!material) return fail("원재료를 찾을 수 없습니다", 404)
  } else material = await materialForGel(product.gelType)

  const moves = await prisma.crmStockMove.findMany({
    where: { productId: product.id, ...(excludeProductionId ? { NOT: { productionId: excludeProductionId } } : {}) },
    select: { direction: true, quantity: true, concentrationPct: true },
  })
  const lotBeforeMl = lotMl(gelLots(moves), c.conc)
  const materialGrams = material ? gelMaterialGrams(c.conc, totalMl) : 0
  let matBefore = material?.grams ?? 0
  if (material && excludeProductionId) {
    // 고치기: 이 생산이 이미 뺀 원료는 돌려놓고 본다
    const own = await prisma.crmStockMove.findMany({ where: { productionId: excludeProductionId, productId: material.id }, select: { direction: true, quantity: true } })
    matBefore = round3(matBefore + own.reduce((a, m) => a + (m.direction === "OUT" ? 1 : -1) * Number(m.quantity), 0))
    material = { ...material, grams: matBefore }
  }
  const warnings = [
    material ? materialShortWarning(material.name, matBefore, materialGrams) : `이 타입에 이어진 원재료가 없어 원재료를 차감하지 않습니다(설정 ${"crm_gel_material_map"}).`,
  ].filter((w): w is string => Boolean(w))

  const photoFileIds = [...new Set(d.photoFileIds ?? [])]
  if (photoFileIds.length) {
    const files = await prisma.file.findMany({ where: { id: { in: photoFileIds }, privateToUserId: null }, select: { id: true } })
    if (files.length !== photoFileIds.length) return fail("사진 파일을 찾을 수 없습니다 — 다시 올려 주세요", 404)
  }
  return {
    ok: true,
    value: { product, conc: c.conc, totalMl, material, materialGrams, lotBeforeMl, warnings, producedAt: d.producedAt, note: d.note ?? null, photoFileIds },
  }
}

type ProductionPlanned = ProductionPlanValue & { producedAt: Date; note: string | null; photoFileIds: string[] }

/** 생산에서 나오는 장부 줄 — 완제품 IN(ml), 원재료 OUT(g) */
function productionMoves(id: string, code: string, v: ProductionPlanned): Prisma.CrmStockMoveCreateManyInput[] {
  return [
    { movedAt: v.producedAt, productId: v.product.id, direction: "IN" as const, quantity: v.totalMl, concentrationPct: v.conc, note: `생산 ${code}`, productionId: id },
    ...(v.material && v.materialGrams > 0
      ? [{ movedAt: v.producedAt, productId: v.material.id, direction: "OUT" as const, quantity: v.materialGrams, note: `생산 ${code}`, productionId: id }]
      : []),
  ]
}

export interface ProductionResult {
  id: string
  code: string
  totalMl: number
  materialGrams: number
  materialName: string | null
  warnings: string[]
  summary: string
}

const productionSummary = (v: ProductionPlanValue) => variantLabel(v.product.name, v.conc, v.totalMl)

/**
 * 생산 한 건. 완제품(타입 · 농도)이 늘고 원재료가 준다 — 두 장부가 한 트랜잭션에서 함께 움직인다.
 * 따로 두면 엑셀처럼 "DNA 는 줄었는데 제품은 안 늘어난" 상태가 생긴다. 원재료가 모자라도 막지 않고 경고한다.
 */
export async function createProduction(input: unknown): Promise<OpResult<ProductionResult>> {
  const p = await planProductionInput(input)
  if (!p.ok) return p
  const v = p.value
  const production = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const codes = (await tx.crmProduction.findMany({ select: { code: true } })).map((x) => x.code)
      const created = await tx.crmProduction.create({
        data: {
          code: nextCode("MFG", codes),
          producedAt: v.producedAt,
          concentrationPct: v.conc,
          totalMl: v.totalMl,
          materialGrams: v.materialGrams,
          note: v.note,
          photoFileIds: v.photoFileIds,
          product: { connect: { id: v.product.id } },
          ...(v.material ? { material: { connect: { id: v.material.id } } } : {}),
        },
      })
      await tx.crmStockMove.createMany({ data: productionMoves(created.id, created.code, v) })
      return created
    })
  )
  return {
    ok: true,
    value: { id: production.id, code: production.code, totalMl: v.totalMl, materialGrams: v.materialGrams, materialName: v.material?.name ?? null, warnings: v.warnings, summary: productionSummary(v) },
  }
}

/** 생산 고치기 — 준 칸만이 아니라 생산 전체를 새 값으로 바꾼다(팝업이 전부 보낸다). 장부 줄을 다시 만들어 재고 · 원재료 차감이 다시 계산된다 */
export async function updateProduction(id: string, input: unknown): Promise<OpResult<ProductionResult & { before: string }>> {
  const before = await prisma.crmProduction.findUnique({ where: { id }, include: { product: true } })
  if (!before) return fail("생산 기록을 찾을 수 없습니다", 404)
  const p = await planProductionInput(input, id)
  if (!p.ok) return p
  const v = p.value
  await prisma.$transaction(async (tx) => {
    await tx.crmStockMove.deleteMany({ where: { productionId: id } })
    await tx.crmProduction.update({
      where: { id },
      data: {
        producedAt: v.producedAt,
        quantity: null,
        concentrationPct: v.conc,
        totalMl: v.totalMl,
        materialGrams: v.materialGrams,
        note: v.note,
        photoFileIds: v.photoFileIds,
        product: { connect: { id: v.product.id } },
        material: v.material ? { connect: { id: v.material.id } } : { disconnect: true },
      },
    })
    await tx.crmStockMove.createMany({ data: productionMoves(id, before.code, v) })
  })
  const beforeText = variantLabel(before.product.name, before.concentrationPct != null ? Number(before.concentrationPct) : null, Number(before.totalMl ?? 0))
  return {
    ok: true,
    value: { id, code: before.code, totalMl: v.totalMl, materialGrams: v.materialGrams, materialName: v.material?.name ?? null, warnings: v.warnings, summary: productionSummary(v), before: beforeText },
  }
}

/** 생산 지우기 — 그 생산에서 나온 장부 줄(완제품 IN · 원재료 OUT)이 함께 사라져 재고가 생산 전으로 돌아간다(onDelete: Cascade) */
export async function deleteProduction(id: string): Promise<OpResult<{ code: string; summary: string; materialGrams: number }>> {
  const p = await prisma.crmProduction.findUnique({ where: { id }, include: { product: true } })
  if (!p) return fail("생산 기록을 찾을 수 없습니다", 404)
  await prisma.crmProduction.delete({ where: { id } })
  const summary = variantLabel(p.product.name, p.concentrationPct != null ? Number(p.concentrationPct) : null, Number(p.totalMl ?? 0))
  return { ok: true, value: { code: p.code, summary, materialGrams: Number(p.materialGrams) } }
}

// ─── 출고 ───────────────────────────────────────────────────────────

export const shipmentCreateSchema = z.object({
  shippedAt: z.coerce.date(),
  kind: z.enum(CrmShipmentKind).default(CrmShipmentKind.SALE),
  orgId: z.string().uuid(),
  productId: z.string().uuid(),
  /** 개수 — 젤 타입이 아닌 제품만. 젤 타입은 volumeMl(출고 ml) */
  quantity: z.number().int().min(1, "수량은 1 이상이어야 합니다").optional().nullable(),
  status: z.enum(CrmShipmentStatus).default(CrmShipmentStatus.PREPARING),
  quoteId: z.string().uuid().optional().nullable(),
  sampleRequestId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  /** 젤 타입 제품이면 필수 — 농도(%) · 출고 ml(총량). 개수는 세지 않는다 */
  concentrationPct: z.union([z.number(), z.string()]).optional().nullable(),
  volumeMl: z.union([z.number(), z.string()]).optional().nullable(),
})

/** 출고 한 줄 + 그만큼 재고 출고 — 트랜잭션 안에서(샘플 고치기가 같은 트랜잭션에서 부른다) */
async function createShipmentTx(tx: Tx, d: Omit<z.infer<typeof shipmentCreateSchema>, "concentrationPct" | "volumeMl"> & { concentrationPct?: number | null; volumeMl?: number | null }) {
  const { orgId, productId, quoteId, sampleRequestId, quantity, shippedAt, concentrationPct, volumeMl, ...rest } = d
  const codes = (await tx.crmShipment.findMany({ select: { code: true } })).map((s) => s.code)
  const gel = concentrationPct != null && volumeMl != null ? { concentrationPct, volumeMl } : null
  if (!gel && !quantity) throw new Error("createShipmentTx: 젤이 아닌 출고에 수량이 없다")
  const created = await tx.crmShipment.create({
    data: {
      ...rest,
      ...(gel ?? {}),
      code: nextCode("SH", codes),
      shippedAt,
      quantity: gel ? null : quantity,
      org: { connect: { id: orgId } },
      product: { connect: { id: productId } },
      quote: quoteId ? { connect: { id: quoteId } } : undefined,
      sampleRequest: sampleRequestId ? { connect: { id: sampleRequestId } } : undefined,
    },
  })
  await tx.crmStockMove.create({
    data: {
      movedAt: shippedAt, productId, direction: "OUT", note: `출고 ${created.code}`, shipmentId: created.id,
      // 젤 타입은 그 농도 칸에서 ml 로 뺀다
      ...(gel ? { quantity: gel.volumeMl, concentrationPct: gel.concentrationPct } : { quantity: quantity! }),
    },
  })
  return created
}

/**
 * 출고 한 건. 완제품 재고를 함께 뺀다.
 *
 * 두 일이 한 트랜잭션에서 움직인다 — 따로 두면 "물건은 나갔는데 재고는 그대로" 가
 * 된다. 엑셀이 정확히 그 상태였다: 출고 23건이 있는데 재고의 총 출고량은 0.
 *
 * 재고가 모자라도 막지는 않는다. 실제로 나간 물건을 못 적게 하면 사람이 장부 밖에서
 * 처리하고, 그때부터 장부는 아무 쓸모가 없다. 대신 음수가 되면 화면이 빨갛게 알린다.
 */
export async function createShipment(input: unknown): Promise<OpResult<Prisma.CrmShipmentGetPayload<object>>> {
  const parsed = shipmentCreateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const product = await prisma.crmProduct.findUnique({ where: { id: parsed.data.productId } })
  if (!product) return fail("제품을 찾을 수 없습니다", 404)
  const g = gelVariant(product, parsed.data, { needVolume: true })
  if (!g.ok) return fail(g.error)
  if (!product.gelType && !parsed.data.quantity) return fail("수량을 적어 주세요")
  const shipment = await createWithUniqueCode(() =>
    prisma.$transaction((tx) => createShipmentTx(tx, { ...parsed.data, concentrationPct: g.conc, volumeMl: g.volumeMl }))
  )
  return { ok: true, value: shipment }
}

export const shipmentPatchSchema = z.object({
  status: z.enum(CrmShipmentStatus).optional(),
  kind: z.enum(CrmShipmentKind).optional(),
  shippedAt: z.coerce.date().optional(),
  orgId: z.string().uuid().optional(),
  /** 제품을 바꿀 때 — 젤 타입이면 농도 · ml 도 함께(없으면 지금 값) */
  productId: z.string().uuid().optional(),
  /** 개수 — 젤 타입이 아닌 출고만 */
  quantity: z.number().int().min(1, "수량은 1 이상이어야 합니다").optional(),
  /** 농도(%) · 출고 ml — 젤 타입 출고만 */
  concentrationPct: z.union([z.number(), z.string()]).optional(),
  volumeMl: z.union([z.number(), z.string()]).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

/** 출고 양(개 · 젤은 ml)을 고치면 재고 장부도 따라간다. 안 그러면 둘이 어긋난 채 남는다. */
async function shipmentAmountTx(tx: Tx, shipmentId: string, before: number | null, after: number | undefined) {
  if (after != null && after !== before) await tx.crmStockMove.updateMany({ where: { shipmentId }, data: { quantity: after } })
}

/** 출고 한 줄의 글 — "애드젤 (ADD GEL) · 10% · 5ml" · "고정제 3개" */
export function shipmentSummary(product: { name: string; spec?: string | null; gelType: string | null }, s: { quantity: number | null; concentrationPct: unknown; volumeMl: unknown }) {
  const n = (v: unknown) => (v == null ? null : Number(v))
  if (product.gelType) return variantLabel(product.name, n(s.concentrationPct), n(s.volumeMl) ?? 0)
  return `${product.name}${product.spec ? ` ${product.spec}` : ""} ${s.quantity ?? 0}개`
}

export interface ShipmentResult {
  id: string
  code: string
  summary: string
  /** 고치기 — 고치기 전 글 */
  before?: string
  /** 재고에 반영된 출고인가(엑셀에서 넘어온 지난 출고는 장부 줄이 없다) */
  ledger: boolean
  warnings: string[]
}

/**
 * 출고 고치기 — 생산 고치기와 같은 수준. 제품 · 농도 · ml(개수) · 거래처 · 날짜 · 유형 · 상태 · 메모를 고칠 수 있다.
 * 재고에 반영된 출고면 그 출고의 장부 줄을 새 값으로 다시 만든다(다른 칸 · 다른 제품으로 옮겨도 맞는다).
 * 엑셀에서 넘어온 「미반영」 출고는 장부 줄을 새로 만들지 않는다 — 어느 생산분에서 나갔는지 모르는 채 빼면 숫자를 지어내는 셈이다.
 * 샘플요청에서 나온 출고는 기관 · 제품을 여기서 바꾸지 않는다(샘플요청에서 고친다). 농도 · ml · 날짜는 그 요청에도 따라 적는다.
 */
export async function updateShipment(shipmentId: string, input: unknown): Promise<OpResult<ShipmentResult>> {
  const parsed = shipmentPatchSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const before = await prisma.crmShipment.findUnique({
    where: { id: shipmentId },
    include: { product: { select: { id: true, gelType: true, name: true, spec: true } }, sampleRequest: { select: { id: true, code: true, orgId: true, _count: { select: { shipments: true } } } }, _count: { select: { stockMoves: true } } },
  })
  if (!before) return fail("출고를 찾을 수 없습니다", 404)
  const d = parsed.data
  const sample = before.sampleRequest
  if (sample && d.orgId && d.orgId !== before.orgId) return fail(`샘플요청 ${sample.code} 에서 나온 출고입니다 — 기관은 샘플요청에서 고쳐 주세요`)
  if (sample && d.productId && d.productId !== before.productId) return fail(`샘플요청 ${sample.code} 에서 나온 출고입니다 — 제품은 샘플요청에서 고쳐 주세요`)
  if (d.orgId && d.orgId !== before.orgId && !(await prisma.crmOrg.findUnique({ where: { id: d.orgId }, select: { id: true } }))) return fail("기관을 찾을 수 없습니다", 404)

  const sameProduct = !d.productId || d.productId === before.productId
  const product = sameProduct ? before.product : await prisma.crmProduct.findUnique({ where: { id: d.productId! }, select: { id: true, gelType: true, name: true, spec: true } })
  if (!product) return fail("제품을 찾을 수 없습니다", 404)
  const num = (v: unknown) => (v == null ? null : Number(v))

  let quantity: number | null = null
  let conc: number | null = null
  let ml: number | null = null
  if (product.gelType) {
    if (d.quantity !== undefined) return fail(`${product.name} 출고는 개수를 세지 않습니다 — ml 로 고쳐 주세요`)
    const g = gelVariant(product, {
      concentrationPct: d.concentrationPct ?? (sameProduct ? num(before.concentrationPct) : null),
      volumeMl: d.volumeMl ?? (sameProduct ? num(before.volumeMl) : null),
    }, { needVolume: true })
    if (!g.ok) return fail(g.error)
    conc = g.conc
    ml = g.volumeMl
  } else {
    if (d.volumeMl !== undefined || d.concentrationPct !== undefined) return fail("농도 · ml 는 젤 타입(애드젤 · 라이브젤) 출고에만 씁니다 — 수량으로 고쳐 주세요")
    quantity = d.quantity ?? (sameProduct ? before.quantity : null)
    if (!quantity) return fail(`${product.name} 은 개수로 셉니다 — 수량을 적어 주세요`)
  }
  const ledger = before._count.stockMoves > 0
  const shippedAt = d.shippedAt ?? before.shippedAt
  const beforeText = shipmentSummary(before.product, before)
  const summary = shipmentSummary(product, { quantity, concentrationPct: conc, volumeMl: ml })

  await prisma.$transaction(async (tx) => {
    await tx.crmShipment.update({
      where: { id: shipmentId },
      data: {
        ...(d.status ? { status: d.status } : {}),
        ...(d.kind ? { kind: d.kind } : {}),
        ...(d.note !== undefined ? { note: d.note } : {}),
        ...(d.orgId ? { org: { connect: { id: d.orgId } } } : {}),
        ...(sameProduct ? {} : { product: { connect: { id: product.id } } }),
        shippedAt, quantity, concentrationPct: conc, volumeMl: ml,
      },
    })
    if (ledger) {
      // 이 출고에서 나온 장부 줄을 새 값으로 다시 만든다 — 젤은 그 농도 칸의 ml, 아니면 개
      await tx.crmStockMove.deleteMany({ where: { shipmentId } })
      await tx.crmStockMove.create({
        data: {
          movedAt: shippedAt, productId: product.id, direction: "OUT", note: `출고 ${before.code}`, shipmentId,
          ...(product.gelType ? { quantity: ml!, concentrationPct: conc } : { quantity: quantity! }),
        },
      })
    }
    // 샘플요청에서 나온 젤 출고 하나뿐이면 요청의 농도 · 보낸 ml 도 같이 맞춘다(목록 · 집계가 요청 쪽 값을 읽는다)
    if (sample && sample._count.shipments === 1) {
      await tx.crmSampleRequest.update({
        where: { id: sample.id },
        data: { ...(product.gelType ? { concentrationPct: conc, volumeMl: ml } : {}), ...(d.shippedAt ? { requestedAt: d.shippedAt } : {}) },
      })
    }
  })
  const warnings = ledger ? [] : ["엑셀에서 넘어온 「미반영」 출고라 재고는 바꾸지 않았습니다."]
  return { ok: true, value: { id: shipmentId, code: before.code, summary, before: beforeText, ledger, warnings } }
}

/** 출고를 지우면 딸린 재고 줄도 함께 사라진다 (스키마의 onDelete: Cascade) — 재고가 출고 전으로 돌아간다 */
export async function deleteShipment(shipmentId: string): Promise<OpResult<ShipmentResult>> {
  const s = await prisma.crmShipment.findUnique({ where: { id: shipmentId }, include: { product: { select: { name: true, spec: true, gelType: true } }, _count: { select: { stockMoves: true } } } })
  if (!s) return fail("출고를 찾을 수 없습니다", 404)
  await prisma.crmShipment.delete({ where: { id: shipmentId } })
  return { ok: true, value: { id: shipmentId, code: s.code, summary: shipmentSummary(s.product, s), ledger: s._count.stockMoves > 0, warnings: [] } }
}

// ─── 샘플요청 ────────────────────────────────────────────────────────

/** 발송 여부 토글. 목록에서 바로 누를 수 있어야 한다 — 상세로 들어갈 일이 아니다. */
export async function setSampleSent(id: string, sent: boolean) {
  return prisma.crmSampleRequest.update({
    where: { id },
    data: { status: sent ? CrmSampleStatus.SENT : CrmSampleStatus.PENDING, sentAt: sent ? new Date() : null },
  })
}

/**
 * 샘플요청을 지운다.
 *
 * 화면에서 지우면 이 요청에서 나간 출고는 남고 연결만 끊긴다 — 보낸 물건은 요청 기록을 지운다고
 * 돌아오지 않는다. withShipments 면 딸린 샘플 출고도 함께 지워 재고가 돌아온다(잘못 적은 기록을 통째로 거둘 때).
 */
export async function deleteSampleRequest(id: string, opts: { withShipments?: boolean } = {}): Promise<OpResult<{ code: string; shipments: string[] }>> {
  const sample = await prisma.crmSampleRequest.findUnique({ where: { id }, select: { code: true, shipments: { select: { id: true, code: true } } } })
  if (!sample) return fail("샘플요청을 찾을 수 없습니다", 404)
  const removed = opts.withShipments ? sample.shipments : []
  await prisma.$transaction(async (tx) => {
    // 출고를 지우면 재고 줄이 Cascade 로 함께 사라진다 — deleteShipment 와 같다
    if (removed.length) await tx.crmShipment.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } })
    await tx.crmSampleRequest.delete({ where: { id } })
  })
  return { ok: true, value: { code: sample.code, shipments: removed.map((s) => s.code) } }
}

export const sampleUpdateSchema = z.object({
  requestedAt: z.coerce.date().optional(),
  orgId: z.string().uuid().optional(),
  contactId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  request: z.string().trim().max(2000).nullable().optional(),
  referral: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  sent: z.boolean().optional(),
  /** 샘플 출고 수량(젤이 아닌 제품). 0 이면 딸린 출고를 지운다(재고가 돌아온다) — 젤 타입도 0 은 출고 지우기 */
  quantity: z.number().int().min(0).max(10000).optional(),
  /** 젤 타입 제품이면 농도(%) · 보낸 ml(총량). 비우면 지금 값. 출고가 없을 때 ml 를 주면 샘플 출고를 만든다 */
  concentrationPct: z.union([z.number(), z.string()]).nullable().optional(),
  volumeMl: z.union([z.number(), z.string()]).nullable().optional(),
})

/**
 * 샘플요청을 고친다. 딸린 샘플 출고(record_sample 이 함께 만든 것)가 따라간다 —
 * 수량은 출고 수량 고치기(updateShipment 와 같은 규칙: 재고 줄이 따라간다), 제품을 바꾸면 출고 · 재고 줄의 제품도,
 * 날짜 · 기관을 바꾸면 출고 날짜 · 기관도. 출고가 둘 이상이면 어느 것을 고칠지 몰라 수량 · 제품은 고치지 않는다.
 */
export async function updateSampleRequest(id: string, input: unknown): Promise<OpResult<{ code: string; shipment: { code: string; quantity: number | null; ml: number | null } | null; removedShipment: string | null }>> {
  const parsed = sampleUpdateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const d = parsed.data
  const before = await prisma.crmSampleRequest.findUnique({
    where: { id },
    include: { shipments: { select: { id: true, code: true, quantity: true, productId: true, kind: true, concentrationPct: true, volumeMl: true } } },
  })
  if (!before) return fail("샘플요청을 찾을 수 없습니다", 404)
  const touchesShipment = d.quantity !== undefined || d.productId !== undefined || d.volumeMl !== undefined
  if (touchesShipment && before.shipments.length > 1) {
    return fail(`이 샘플요청에 출고가 ${before.shipments.length}건(${before.shipments.map((s) => s.code).join(", ")}) 있습니다 — 수량 · 제품은 출고마다 CRM › 출고에서 고쳐 주세요`)
  }
  const productId = d.productId === undefined ? before.productId : d.productId
  const ship = before.shipments[0] ?? null
  if (((d.quantity && d.quantity > 0) || (d.volumeMl != null && d.volumeMl !== "")) && !ship && !productId) return fail("제품이 없어 샘플 출고를 만들 수 없습니다 — product_id 를 함께 주세요")
  if (d.productId) {
    const p = await prisma.crmProduct.findUnique({ where: { id: d.productId }, select: { id: true } })
    if (!p) return fail("제품을 찾을 수 없습니다", 404)
  }
  // 젤 타입이면 농도 · ml 가 있어야 출고를 ml 로 뺄 수 있다 — 준 값, 없으면 지금 값(요청 → 출고 순). 개수는 세지 않는다
  const finalProduct = productId ? await prisma.crmProduct.findUnique({ where: { id: productId }, select: { gelType: true, name: true } }) : null
  const num = (v: unknown) => (v == null ? null : Number(v))
  const sameProduct = productId === before.productId
  let gelConc: number | null = null
  let gelVol: number | null = null
  if (finalProduct?.gelType) {
    const g = gelVariant(finalProduct, {
      concentrationPct: d.concentrationPct ?? (sameProduct ? num(before.concentrationPct) ?? num(ship?.concentrationPct) : null),
      volumeMl: d.volumeMl ?? (sameProduct ? num(before.volumeMl) ?? num(ship?.volumeMl) : null),
    }, { needVolume: Boolean(ship) })
    if (!g.ok) return fail(g.error)
    if (d.quantity && d.quantity > 0) return fail(`${finalProduct.name} 은 젤 타입이라 개수를 세지 않습니다 — volume_ml(보낸 ml)로 적어 주세요`)
    gelConc = g.conc
    gelVol = g.volumeMl
  }
  // 젤 출고를 젤이 아닌 제품으로 바꾸면 개수가 있어야 한다 — 지난 젤 출고에는 개수가 없다
  if (ship && productId && d.quantity !== 0 && !finalProduct?.gelType && !(d.quantity ?? ship.quantity)) {
    return fail(`${finalProduct?.name ?? "제품"} 은 개수로 셉니다 — quantity 를 함께 주세요`)
  }
  const touchesGel = d.concentrationPct !== undefined || d.volumeMl !== undefined
  const orgId = d.orgId ?? before.orgId
  const at = d.requestedAt ?? before.requestedAt

  const r = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      await tx.crmSampleRequest.update({
        where: { id },
        data: {
          ...(d.requestedAt ? { requestedAt: d.requestedAt } : {}),
          ...(d.orgId ? { orgId: d.orgId } : {}),
          ...(d.contactId !== undefined ? { contactId: d.contactId } : {}),
          ...(d.productId !== undefined ? { productId: d.productId } : {}),
          ...(d.request !== undefined ? { request: d.request } : {}),
          ...(d.referral !== undefined ? { referral: d.referral } : {}),
          ...(d.note !== undefined ? { note: d.note } : {}),
          ...(finalProduct?.gelType ? { concentrationPct: gelConc, volumeMl: gelVol } : d.productId !== undefined ? { concentrationPct: null, volumeMl: null } : {}),
          ...(d.sent !== undefined
            ? { status: d.sent ? CrmSampleStatus.SENT : CrmSampleStatus.PENDING, sentAt: d.sent ? (before.sentAt ?? at) : null }
            : d.requestedAt && before.sentAt ? { sentAt: d.requestedAt } : {}),
        },
      })
      let shipment: { code: string; quantity: number | null; ml: number | null } | null = null
      let removedShipment: string | null = null
      if (ship) {
        // 수량 0 · 제품을 지움 → 출고째 지운다(재고 줄이 Cascade 로 사라져 재고가 돌아온다)
        if (d.quantity === 0 || d.productId === null) {
          await tx.crmShipment.delete({ where: { id: ship.id } })
          removedShipment = ship.code
        } else {
          const gel = finalProduct?.gelType && gelConc != null && gelVol != null ? { concentrationPct: gelConc, volumeMl: gelVol } : null
          // 젤이 아닌 제품으로 바꾸면 개수가 있어야 한다 — 지난 젤 출고에는 개수가 없다
          const quantity = gel ? null : d.quantity ?? ship.quantity
          await tx.crmShipment.update({
            where: { id: ship.id },
            data: {
              quantity,
              ...(productId && productId !== ship.productId ? { productId } : {}),
              ...(d.orgId ? { orgId: d.orgId } : {}),
              ...(d.requestedAt ? { shippedAt: d.requestedAt } : {}),
              ...(gel ?? (productId !== ship.productId ? { concentrationPct: null, volumeMl: null } : {})),
            },
          })
          if (gel || touchesGel || productId !== ship.productId) {
            // 제품 · 농도 · ml 가 바뀌면 재고 줄을 통째로 다시 맞춘다(젤은 그 농도 칸의 ml, 아니면 개)
            await tx.crmStockMove.updateMany({
              where: { shipmentId: ship.id },
              data: gel
                ? { productId: productId!, quantity: gel.volumeMl, concentrationPct: gel.concentrationPct }
                : { productId: productId!, quantity: quantity!, concentrationPct: null },
            })
          } else await shipmentAmountTx(tx, ship.id, ship.quantity, quantity ?? undefined)
          if (d.requestedAt) await tx.crmStockMove.updateMany({ where: { shipmentId: ship.id }, data: { movedAt: d.requestedAt } })
          shipment = { code: ship.code, quantity, ml: gel?.volumeMl ?? null }
        }
      } else if (productId && (finalProduct?.gelType ? gelVol != null && d.volumeMl != null && d.volumeMl !== "" : Boolean(d.quantity))) {
        const created = await createShipmentTx(tx, {
          shippedAt: at, kind: CrmShipmentKind.SAMPLE, status: CrmShipmentStatus.DELIVERED,
          orgId, productId, quantity: finalProduct?.gelType ? null : d.quantity!, sampleRequestId: id,
          concentrationPct: gelConc, volumeMl: gelVol,
        })
        shipment = { code: created.code, quantity: created.quantity, ml: gelVol }
      }
      return { code: before.code, shipment, removedShipment }
    })
  )
  return { ok: true, value: r }
}

// ─── 견적 ───────────────────────────────────────────────────────────

/** 견적 만들기 — 담당자가 그 기관 소속인지 본다(엑셀은 이름 문자열이라 아무 조합이나 됐다) */
export async function createQuote(input: unknown): Promise<OpResult<Prisma.CrmQuoteGetPayload<{ include: { items: true } }> & { totals: ReturnType<typeof quoteTotals> }>> {
  const parsed = quoteCreateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { items, quotedAt, orgId, contactId, membershipId, ...rest } = parsed.data
  if (contactId) {
    const c = await prisma.crmContact.findUnique({ where: { id: contactId } })
    if (!c || c.orgId !== orgId) return fail("담당자가 이 기관 소속이 아닙니다")
  }
  // 젤 타입 품목은 (농도, 한 개 용량) 이 있어야 한다 — 출고할 때 그 칸의 재고에서 빠진다
  const products = await prisma.crmProduct.findMany({ where: { id: { in: items.map((it) => it.productId) } }, select: { id: true, gelType: true, name: true } })
  const gelOf: { conc: number | null; volumeMl: number | null }[] = []
  for (const [i, it] of items.entries()) {
    const p = products.find((x) => x.id === it.productId)
    if (!p) return fail(`${i + 1}번째 품목의 제품을 찾을 수 없습니다`, 404)
    const g = gelVariant(p, it, { needVolume: true })
    if (!g.ok) return fail(`${i + 1}번째 품목 — ${g.error}`)
    gelOf.push({ conc: g.conc, volumeMl: g.volumeMl })
  }
  const quote = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const codes = (await tx.crmQuote.findMany({ select: { code: true } })).map((q) => q.code)
      return tx.crmQuote.create({
        data: {
          ...rest,
          code: nextDatedCode(quotedAt, codes),
          quotedAt,
          org: { connect: { id: orgId } },
          contact: contactId ? { connect: { id: contactId } } : undefined,
          membership: membershipId ? { connect: { id: membershipId } } : undefined,
          items: {
            create: items.map((it, i) => ({
              quantity: it.quantity, unitPrice: it.unitPrice, note: it.note ?? null, sortOrder: i,
              concentrationPct: gelOf[i].conc, volumeMl: gelOf[i].volumeMl,
              product: { connect: { id: it.productId } },
            })),
          },
        },
        include: { items: true },
      })
    })
  )
  // 응답에 계산 결과를 함께 준다 — 화면이 같은 식을 다시 짜지 않게.
  return { ok: true, value: { ...quote, totals: quoteTotals(quote.items, quote.discountAmount, quote.vatRate) } }
}

export const quotePatchSchema = z.object({
  status: z.enum(CrmQuoteStatus).optional(),
  /** 세금계산서 발행일. 지우려면 null 을 보낸다 */
  taxInvoicedAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

/**
 * 견적 고치기(상태 · 비고 · 발행일). 완료가 됐는데 세금계산서가 없으면 재무 담당에게 발행을 부탁한다 —
 * 담당자가 메신저로 전하던 일이다. 알림을 누르면 이 견적이 잡힌 채 세금계산서 등록이 열린다.
 */
export async function updateQuote(quoteId: string, input: unknown, actor: { id: string; name?: string | null }) {
  const parsed = quotePatchSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const before = await prisma.crmQuote.findUnique({ where: { id: quoteId } })
  if (!before) return fail("견적을 찾을 수 없습니다", 404)
  // 완료로 옮길 때 세금계산서 발행일을 오늘로 채우던 것을 멈춘다(2026-09-17).
  // 세금계산서가 없어도 「발행」 으로 보여서 재무 담당에게 틀린 정보였다. 발행일은 세금계산서가 이어질 때만 적힌다(lib/tax-invoice-save).
  const data = { ...parsed.data }
  const quote = await prisma.crmQuote.update({
    where: { id: quoteId },
    data,
    include: { org: { select: { name: true } }, _count: { select: { taxInvoices: true } } },
  })
  if (data.status === CrmQuoteStatus.DONE && before.status !== CrmQuoteStatus.DONE && quote._count.taxInvoices === 0) {
    const finance = await prisma.user.findMany({
      where: { isActive: true, department: { contains: "재무" }, id: { not: actor.id } },
      select: { id: true },
    })
    for (const u of finance) {
      await createNotification(
        u.id,
        "crm_invoice_request",
        `세금계산서 발행 요청: ${quote.org.name}`,
        `${actor.name ?? "담당자"}님이 견적 ${quote.code} 를 완료했습니다. 세금계산서를 발행해 올려 주세요.`,
        quote.id
      )
    }
  }
  return { ok: true as const, value: quote }
}

/** 견적을 지운다. 품목은 함께 사라지고(Cascade), 출고는 남고 연결만 끊긴다(SetNull) — 나간 물건은 없던 일이 되지 않는다 */
export async function deleteQuote(quoteId: string): Promise<OpResult<{ code: string }>> {
  const quote = await prisma.crmQuote.findUnique({ where: { id: quoteId }, select: { code: true } })
  if (!quote) return fail("견적을 찾을 수 없습니다", 404)
  await prisma.crmQuote.delete({ where: { id: quoteId } })
  return { ok: true, value: { code: quote.code } }
}

// ─── 입금 ───────────────────────────────────────────────────────────

export const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD"),
  amountKrw: z.coerce.number().int("금액은 원 단위 정수").positive("금액은 0보다 커야 합니다"),
  note: z.string().trim().max(200).optional().nullable(),
})

/** 들어온 돈 · 나간 돈 한 줄. 나눠 들어오면 여러 번 적는다. 묶음(수정세금계산서 포함)의 남은 금액을 넘지 않게 — 두 번 적는 실수를 막는다 */
export async function createPayment(input: unknown, userId: string): Promise<OpResult<{ id: string; remaining: number | null }>> {
  const parsed = paymentSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { invoiceId, paidOn, amountKrw, note } = parsed.data
  const invoice = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, direction: true, approvalNo: true, originalApprovalNo: true, buyerName: true, supplierName: true } })
  if (!invoice) return fail("세금계산서를 찾을 수 없습니다", 404)
  const root = invoice.originalApprovalNo ?? invoice.approvalNo
  const chain = (await receivableChains(invoice.direction)).find((c) => c.approvalNo === root || c.invoiceId === invoiceId)
  if (chain && amountKrw > chain.remaining) return fail(`남은 금액(${chain.remaining.toLocaleString("ko-KR")}원)보다 많습니다`, 409)
  const payment = await prisma.crmPayment.create({
    data: { invoiceId, paidOn: new Date(`${paidOn}T00:00:00Z`), amountKrw: BigInt(amountKrw), note: note || null, createdById: userId },
  })
  const who = invoice.direction === "SALE" ? invoice.buyerName : invoice.supplierName
  await writeActivity({
    userId,
    action: invoice.direction === "SALE" ? "crm.payment.received" : "crm.payment.paid",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: `${invoice.direction === "SALE" ? "입금" : "지급"}: ${who} ${amountKrw.toLocaleString("ko-KR")}원 (${paidOn})`,
    metadata: { paymentId: payment.id, amountKrw },
  })
  return { ok: true, value: { id: payment.id, remaining: chain ? chain.remaining - amountKrw : null } }
}

// ─── 담당자 · 입금 지우기 · 세금계산서 · 홈페이지 문의 (#248) ───────────────
// 아래도 라우트 안에 있던 것을 그대로 옮겼다 — 화면(app/api/crm/*)과 도구(lib/tools/plan-crm.ts)가 같이 부른다.

/** 기관에 담당자 한 명 */
export async function createContact(input: unknown): Promise<OpResult<Prisma.CrmContactGetPayload<object>>> {
  const parsed = contactCreateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { orgId, ...fields } = parsed.data
  const org = await prisma.crmOrg.findUnique({ where: { id: orgId } })
  if (!org) return fail("기관을 찾을 수 없습니다", 404)
  const contact = await createWithUniqueCode(async () => {
    const codes = (await prisma.crmContact.findMany({ select: { code: true } })).map((c) => c.code)
    return prisma.crmContact.create({ data: { ...fields, code: nextCode("CT", codes), org: { connect: { id: orgId } } } })
  })
  return { ok: true, value: contact }
}

/** 잘못 적은 입금 한 줄 지우기 — 누가 지웠는지 활동 기록에 남는다 */
export async function deletePayment(paymentId: string, userId: string): Promise<OpResult<{ invoiceId: string; amount: number }>> {
  const p = await prisma.crmPayment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { buyerName: true, supplierName: true, direction: true } } } })
  if (!p) return fail("없는 기록입니다", 404)
  await prisma.crmPayment.delete({ where: { id: paymentId } })
  await writeActivity({
    userId,
    action: "crm.payment.deleted",
    entity: "TAX_INVOICE",
    entityId: p.invoiceId,
    title: `입금 기록 삭제: ${p.invoice.direction === "SALE" ? p.invoice.buyerName : p.invoice.supplierName} ${Number(p.amountKrw).toLocaleString("ko-KR")}원`,
    metadata: { paidOn: p.paidOn.toISOString().slice(0, 10) },
  })
  return { ok: true, value: { invoiceId: p.invoiceId, amount: Number(p.amountKrw) } }
}

/**
 * 입금 기록을 쓰기 전에 이미 받은 매출 세금계산서를 한 번에 「받음」 으로(2026-09-17).
 * 입금일을 지어 넣지 않는다: 발행일로 두고 메모에 「실제 입금일 모름」(SETTLE_NOTE)을 남긴다. 지우면 되돌아간다.
 */
export async function settlePayments(invoiceIds: string[], userId: string): Promise<OpResult<{ settled: number; total: number }>> {
  if (invoiceIds.length === 0 || invoiceIds.length > 500) return fail("고른 세금계산서가 없습니다")
  const want = new Set(invoiceIds)
  const chains = (await receivableChains("SALE")).filter((c) => want.has(c.invoiceId) && c.remaining > 0)
  await prisma.crmPayment.createMany({
    data: chains.map((c) => ({ invoiceId: c.invoiceId, paidOn: new Date(`${c.issuedOn}T00:00:00Z`), amountKrw: BigInt(c.remaining), note: SETTLE_NOTE, createdById: userId })),
  })
  const total = chains.reduce((a, c) => a + c.remaining, 0)
  await writeActivity({
    userId,
    action: "crm.payment.settled",
    entity: "TAX_INVOICE",
    entityId: null,
    title: `시작 전 정리: ${chains.length}건 받음으로 표시 · ${total.toLocaleString("ko-KR")}원`,
    metadata: { invoiceIds: chains.map((c) => c.invoiceId) },
  })
  return { ok: true, value: { settled: chains.length, total } }
}

/**
 * 세금계산서를 견적에 잇거나(quoteId) 끊는다(null) — 2026-09-17.
 * 대학은 견적은 학과로, 세금계산서는 산학협력단으로 나가 자동으로 못 잇는다. 사람이 한 번 눌러 잇는다.
 */
export async function linkTaxInvoice(invoiceId: string, quoteId: string | null, userId: string): Promise<OpResult<{ quoteCode: string | null }>> {
  const inv = await prisma.taxInvoice.findUnique({ where: { id: invoiceId }, select: { id: true, issuedOn: true, buyerName: true, direction: true } })
  if (!inv) return fail("세금계산서를 찾을 수 없습니다", 404)
  if (inv.direction !== "SALE" && quoteId) return fail("매입 세금계산서는 견적에 잇지 않습니다")
  const quote = quoteId ? await prisma.crmQuote.findUnique({ where: { id: quoteId }, select: { id: true, code: true } }) : null
  if (quoteId && !quote) return fail("견적을 찾을 수 없습니다", 404)
  await prisma.taxInvoice.update({ where: { id: invoiceId }, data: { quoteId: quote?.id ?? null } })
  if (quote) await prisma.crmQuote.updateMany({ where: { id: quote.id, taxInvoicedAt: null }, data: { taxInvoicedAt: inv.issuedOn } })
  await writeActivity({
    userId,
    action: "crm.invoice.linked",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: quote ? `세금계산서 ↔ 견적 잇기: ${inv.buyerName} · ${quote.code}` : `세금계산서 견적 연결 끊기: ${inv.buyerName}`,
  })
  return { ok: true, value: { quoteCode: quote?.code ?? null } }
}

/**
 * 세금계산서 지우기(2026-10-29) — 잘못 올렸거나 취소 뒤 새로 발행한 경우.
 * NAS 원본 PDF 는 지우지 않는다(증빙 · 공용 저장소). 입금 기록은 스키마대로 함께 지워진다.
 */
export async function deleteTaxInvoice(invoiceId: string, userId: string): Promise<OpResult<{ payments: number }>> {
  const inv = await prisma.taxInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      approvalNo: true, direction: true, issuedOn: true, buyerName: true, supplierName: true, totalKrw: true, quoteId: true, objectKey: true,
      _count: { select: { payments: true } },
    },
  })
  if (!inv) return fail("세금계산서를 찾을 수 없습니다", 404)
  await prisma.$transaction(async (tx) => {
    await tx.taxInvoice.delete({ where: { id: invoiceId } })
    if (inv.quoteId && !(await tx.taxInvoice.count({ where: { quoteId: inv.quoteId } }))) {
      await tx.crmQuote.update({ where: { id: inv.quoteId }, data: { taxInvoicedAt: null } })
    }
  })
  const counter = inv.direction === "SALE" ? inv.buyerName : inv.supplierName
  await writeActivity({
    userId,
    action: "crm.invoice.deleted",
    entity: "TAX_INVOICE",
    entityId: invoiceId,
    title: `세금계산서 삭제: ${counter} ${Number(inv.totalKrw).toLocaleString("ko-KR")}원`,
    metadata: { approvalNo: inv.approvalNo, issuedOn: inv.issuedOn.toISOString().slice(0, 10), payments: inv._count.payments, objectKey: inv.objectKey },
  })
  return { ok: true, value: { payments: inv._count.payments } }
}

/** 홈페이지 문의 반려 · 스팸 — 문의 상태만 바꾸고 CRM 은 건드리지 않는다 */
export async function rejectInquiry(inquiryId: string, userId: string, input: unknown): Promise<OpResult<{ status: string }>> {
  const parsed = inquiryRejectSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const claimed = await prisma.websiteInquiry.updateMany({
    where: { id: inquiryId, status: "NEW" },
    data: { status: parsed.data.status, reviewNote: parsed.data.reviewNote ?? null, reviewedById: userId, reviewedAt: new Date() },
  })
  if (claimed.count === 0) return fail("이미 처리된 문의입니다", 409)
  return { ok: true, value: { status: parsed.data.status } }
}

/** 홈페이지 문의 승인 — 기관(과 담당자)에 잇고, 고른 대로 빈 견적이나 샘플요청을 만든다 */
export async function acceptInquiry(inquiryId: string, userId: string, input: unknown): Promise<OpResult<{
  outcome: string; orgId: string; contactId: string | null; quoteId: string | null; sampleId: string | null; code: string | null
}>> {
  const parsed = inquiryAcceptSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { orgId, contactId, outcome, note } = parsed.data
  const org = await prisma.crmOrg.findUnique({ where: { id: orgId }, select: { id: true } })
  if (!org) return fail("기관을 찾을 수 없습니다", 404)
  if (contactId) {
    const c = await prisma.crmContact.findUnique({ where: { id: contactId }, select: { orgId: true } })
    if (!c || c.orgId !== orgId) return fail("담당자가 이 기관 소속이 아닙니다")
  }
  const result = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const claimed = await tx.websiteInquiry.updateMany({
        where: { id: inquiryId, status: "NEW" },
        data: { status: "ACCEPTED", reviewNote: note ?? null, reviewedById: userId, reviewedAt: new Date() },
      })
      if (claimed.count === 0) return { conflict: true as const }
      const inquiry = await tx.websiteInquiry.findUniqueOrThrow({ where: { id: inquiryId } })
      const now = new Date()
      const fromInquiry = `홈페이지 문의 (${inquiry.id})\n${inquiry.message}`.slice(0, 2000)
      let quoteId: string | null = null
      let sampleId: string | null = null
      let code: string | null = null
      if (outcome === "quote") {
        const codes = (await tx.crmQuote.findMany({ select: { code: true } })).map((q) => q.code)
        const quote = await tx.crmQuote.create({ data: { code: nextDatedCode(now, codes), quotedAt: now, orgId, contactId: contactId ?? null, status: "DRAFT", note: fromInquiry } })
        quoteId = quote.id
        code = quote.code
      } else if (outcome === "sample") {
        const codes = (await tx.crmSampleRequest.findMany({ select: { code: true } })).map((r) => r.code)
        const sample = await tx.crmSampleRequest.create({
          data: {
            code: nextDatedCode(now, codes), requestedAt: now, orgId, contactId: contactId ?? null,
            request: inquiry.message.slice(0, 2000), referral: "홈페이지 문의", note: `홈페이지 문의 (${inquiry.id})`,
          },
        })
        sampleId = sample.id
        code = sample.code
      }
      await tx.websiteInquiry.update({ where: { id: inquiryId }, data: { orgId, contactId: contactId ?? null, quoteId, sampleId } })
      return { conflict: false as const, outcome, orgId, contactId: contactId ?? null, quoteId, sampleId, code }
    }),
  )
  if (result.conflict) return fail("이미 처리된 문의입니다", 409)
  const { conflict: _c, ...value } = result
  void _c
  return { ok: true, value }
}
