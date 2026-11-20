// CRM 쓰기 — 화면 API(app/api/crm/*)와 AI 도구(lib/crm-write-tools.ts)가 같이 부르는 서버 함수.
//
// 라우트 안에 있던 검증 · 중복 검사 · 재고 계산을 그대로 옮겼다. 라우트는 인증 · JSON 읽기 · 응답 모양만 맡는다.
// 그래서 AI 로 고쳐도 화면에서 고친 것과 같은 규칙을 지난다(#crm-write).
import { z } from "zod"
import { prisma } from "@/lib/db"
import { CrmQuoteStatus, CrmSampleStatus, CrmShipmentKind, CrmShipmentStatus, Prisma } from "@/generated/prisma"
import { billingOrgProblem, contactCreateSchema, gramsForQuantity, nextCode, nextDatedCode, orgCreateSchema, orgUpdateSchema, quoteCreateSchema, quoteTotals } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import { createNotification } from "@/lib/notifications"
import { receivableChains, SETTLE_NOTE } from "@/lib/crm-receivables"
import { inquiryAcceptSchema, inquiryRejectSchema } from "@/lib/website-inquiry"
import { writeActivity } from "@/lib/api"

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
  quantity: z.number().positive("수량은 0보다 커야 합니다"),
  note: z.string().trim().max(500).optional().nullable(),
})

/** 재고 장부에 한 줄 직접 적는다 — 원료 입고, 폐기, 실사 보정 같은 것. */
export async function createStockMove(input: unknown): Promise<OpResult<Prisma.CrmStockMoveGetPayload<object>>> {
  const parsed = stockMoveSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const { productId, ...rest } = parsed.data
  const product = await prisma.crmProduct.findUnique({ where: { id: productId } })
  if (!product) return fail("품목을 찾을 수 없습니다", 404)
  const move = await prisma.crmStockMove.create({
    data: { ...rest, note: rest.note ?? null, product: { connect: { id: productId } } },
  })
  return { ok: true, value: move }
}

/** 장부 한 줄 지우기. 생산·출고에서 파생된 줄은 그쪽에서 지워야 한다. */
export async function deleteStockMove(id: string): Promise<OpResult<{ ok: true }>> {
  const move = await prisma.crmStockMove.findUnique({ where: { id } })
  if (!move) return fail("찾을 수 없습니다", 404)
  if (move.productionId || move.shipmentId) return fail("생산·출고에서 나온 줄입니다. 그 기록을 지워야 함께 사라집니다")
  await prisma.crmStockMove.delete({ where: { id } })
  return { ok: true, value: { ok: true } }
}

// ─── 생산 ───────────────────────────────────────────────────────────

export const productionSchema = z.object({
  producedAt: z.coerce.date(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, "생산 수량은 1 이상이어야 합니다"),
  materialId: z.string().uuid(),
  /** 실제로 쓴 그램. 비우면 용량·농도로 계산한다. */
  materialGrams: z.number().positive().optional(),
  note: z.string().trim().max(2000).optional().nullable(),
})

/** 생산에 쓸 원료 그램 — 보낸 값이 없으면 용량·농도로 계산한다. 둘 다 없으면 계산할 근거가 없다 */
export async function productionGrams(input: z.infer<typeof productionSchema>): Promise<OpResult<{ grams: number; productName: string; materialName: string }>> {
  const [product, material] = await Promise.all([
    prisma.crmProduct.findUnique({ where: { id: input.productId } }),
    prisma.crmProduct.findUnique({ where: { id: input.materialId } }),
  ])
  if (!product) return fail("제품을 찾을 수 없습니다", 404)
  if (!material?.isMaterial) return fail("원료를 찾을 수 없습니다", 404)
  const grams =
    input.materialGrams ??
    gramsForQuantity(
      input.quantity,
      product.volumeMl ? Number(product.volumeMl) : null,
      product.concentrationPct ? Number(product.concentrationPct) : null
    )
  if (grams == null) {
    return fail(`${product.name} 은 용량(ml) 또는 농도(wt%)가 비어 있어 소요량을 계산할 수 없습니다. 쓴 그램을 직접 입력하거나 제품 정보를 채워 주세요`)
  }
  return { ok: true, value: { grams, productName: product.name, materialName: material.name } }
}

/**
 * 생산 한 건. 원료를 빼고 완제품을 더한다.
 *
 * 두 장부가 한 트랜잭션에서 함께 움직인다 — 따로 두면 엑셀처럼 "DNA 는 줄었는데
 * 제품은 안 늘어난" 상태가 생긴다.
 */
export async function createProduction(input: unknown): Promise<OpResult<Omit<Prisma.CrmProductionGetPayload<object>, "materialGrams"> & { materialGrams: number }>> {
  const parsed = productionSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const g = await productionGrams(parsed.data)
  if (!g.ok) return g
  const { productId, materialId, quantity, producedAt, note } = parsed.data
  const grams = g.value.grams
  const production = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      const codes = (await tx.crmProduction.findMany({ select: { code: true } })).map((p) => p.code)
      const created = await tx.crmProduction.create({
        data: {
          code: nextCode("MFG", codes),
          producedAt,
          quantity,
          materialGrams: grams,
          note: note ?? null,
          product: { connect: { id: productId } },
          material: { connect: { id: materialId } },
        },
      })
      await tx.crmStockMove.createMany({
        data: [
          { movedAt: producedAt, productId: materialId, direction: "OUT", quantity: grams, note: `생산 ${created.code}`, productionId: created.id },
          { movedAt: producedAt, productId, direction: "IN", quantity, note: `생산 ${created.code}`, productionId: created.id },
        ],
      })
      return created
    })
  )
  return { ok: true, value: { ...production, materialGrams: grams } }
}

// ─── 출고 ───────────────────────────────────────────────────────────

export const shipmentCreateSchema = z.object({
  shippedAt: z.coerce.date(),
  kind: z.enum(CrmShipmentKind).default(CrmShipmentKind.SALE),
  orgId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1, "수량은 1 이상이어야 합니다"),
  status: z.enum(CrmShipmentStatus).default(CrmShipmentStatus.PREPARING),
  quoteId: z.string().uuid().optional().nullable(),
  sampleRequestId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

/** 출고 한 줄 + 그만큼 재고 출고 — 트랜잭션 안에서(샘플 고치기가 같은 트랜잭션에서 부른다) */
async function createShipmentTx(tx: Tx, d: z.infer<typeof shipmentCreateSchema>) {
  const { orgId, productId, quoteId, sampleRequestId, quantity, shippedAt, ...rest } = d
  const codes = (await tx.crmShipment.findMany({ select: { code: true } })).map((s) => s.code)
  const created = await tx.crmShipment.create({
    data: {
      ...rest,
      code: nextCode("SH", codes),
      shippedAt,
      quantity,
      org: { connect: { id: orgId } },
      product: { connect: { id: productId } },
      quote: quoteId ? { connect: { id: quoteId } } : undefined,
      sampleRequest: sampleRequestId ? { connect: { id: sampleRequestId } } : undefined,
    },
  })
  await tx.crmStockMove.create({
    data: { movedAt: shippedAt, productId, direction: "OUT", quantity, note: `출고 ${created.code}`, shipmentId: created.id },
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
  const shipment = await createWithUniqueCode(() => prisma.$transaction((tx) => createShipmentTx(tx, parsed.data)))
  return { ok: true, value: shipment }
}

export const shipmentPatchSchema = z.object({
  status: z.enum(CrmShipmentStatus).optional(),
  quantity: z.number().int().min(1).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

/** 출고 수량을 고치면 재고 장부도 따라간다. 안 그러면 둘이 어긋난 채 남는다. */
async function shipmentQuantityTx(tx: Tx, shipmentId: string, before: number, quantity: number | undefined) {
  if (quantity != null && quantity !== before) {
    await tx.crmStockMove.updateMany({ where: { shipmentId }, data: { quantity } })
  }
}

export async function updateShipment(shipmentId: string, input: unknown): Promise<OpResult<Prisma.CrmShipmentGetPayload<object>>> {
  const parsed = shipmentPatchSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const before = await prisma.crmShipment.findUnique({ where: { id: shipmentId } })
  if (!before) return fail("출고를 찾을 수 없습니다", 404)
  const shipment = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmShipment.update({ where: { id: shipmentId }, data: parsed.data })
    await shipmentQuantityTx(tx, shipmentId, before.quantity, parsed.data.quantity)
    return updated
  })
  return { ok: true, value: shipment }
}

/** 출고를 지우면 딸린 재고 줄도 함께 사라진다 (스키마의 onDelete: Cascade). */
export async function deleteShipment(shipmentId: string): Promise<OpResult<{ code: string }>> {
  const s = await prisma.crmShipment.findUnique({ where: { id: shipmentId }, select: { code: true } })
  if (!s) return fail("출고를 찾을 수 없습니다", 404)
  await prisma.crmShipment.delete({ where: { id: shipmentId } })
  return { ok: true, value: { code: s.code } }
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
  /** 샘플 출고 수량. 0 이면 딸린 출고를 지운다(재고가 돌아온다) */
  quantity: z.number().int().min(0).max(10000).optional(),
})

/**
 * 샘플요청을 고친다. 딸린 샘플 출고(record_sample 이 함께 만든 것)가 따라간다 —
 * 수량은 출고 수량 고치기(updateShipment 와 같은 규칙: 재고 줄이 따라간다), 제품을 바꾸면 출고 · 재고 줄의 제품도,
 * 날짜 · 기관을 바꾸면 출고 날짜 · 기관도. 출고가 둘 이상이면 어느 것을 고칠지 몰라 수량 · 제품은 고치지 않는다.
 */
export async function updateSampleRequest(id: string, input: unknown): Promise<OpResult<{ code: string; shipment: { code: string; quantity: number } | null; removedShipment: string | null }>> {
  const parsed = sampleUpdateSchema.safeParse(input)
  if (!parsed.success) return fail(firstIssue(parsed.error))
  const d = parsed.data
  const before = await prisma.crmSampleRequest.findUnique({
    where: { id },
    include: { shipments: { select: { id: true, code: true, quantity: true, productId: true, kind: true } } },
  })
  if (!before) return fail("샘플요청을 찾을 수 없습니다", 404)
  const touchesShipment = d.quantity !== undefined || d.productId !== undefined
  if (touchesShipment && before.shipments.length > 1) {
    return fail(`이 샘플요청에 출고가 ${before.shipments.length}건(${before.shipments.map((s) => s.code).join(", ")}) 있습니다 — 수량 · 제품은 출고마다 CRM › 출고에서 고쳐 주세요`)
  }
  const productId = d.productId === undefined ? before.productId : d.productId
  const ship = before.shipments[0] ?? null
  if (d.quantity && d.quantity > 0 && !ship && !productId) return fail("제품이 없어 샘플 출고를 만들 수 없습니다 — product_id 를 함께 주세요")
  if (d.productId) {
    const p = await prisma.crmProduct.findUnique({ where: { id: d.productId }, select: { id: true } })
    if (!p) return fail("제품을 찾을 수 없습니다", 404)
  }
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
          ...(d.sent !== undefined
            ? { status: d.sent ? CrmSampleStatus.SENT : CrmSampleStatus.PENDING, sentAt: d.sent ? (before.sentAt ?? at) : null }
            : d.requestedAt && before.sentAt ? { sentAt: d.requestedAt } : {}),
        },
      })
      let shipment: { code: string; quantity: number } | null = null
      let removedShipment: string | null = null
      if (ship) {
        // 수량 0 · 제품을 지움 → 출고째 지운다(재고 줄이 Cascade 로 사라져 재고가 돌아온다)
        if (d.quantity === 0 || d.productId === null) {
          await tx.crmShipment.delete({ where: { id: ship.id } })
          removedShipment = ship.code
        } else {
          const quantity = d.quantity ?? ship.quantity
          await tx.crmShipment.update({
            where: { id: ship.id },
            data: {
              quantity,
              ...(productId && productId !== ship.productId ? { productId } : {}),
              ...(d.orgId ? { orgId: d.orgId } : {}),
              ...(d.requestedAt ? { shippedAt: d.requestedAt } : {}),
            },
          })
          await shipmentQuantityTx(tx, ship.id, ship.quantity, quantity)
          if (productId && productId !== ship.productId) await tx.crmStockMove.updateMany({ where: { shipmentId: ship.id }, data: { productId } })
          if (d.requestedAt) await tx.crmStockMove.updateMany({ where: { shipmentId: ship.id }, data: { movedAt: d.requestedAt } })
          shipment = { code: ship.code, quantity }
        }
      } else if (d.quantity && productId) {
        const created = await createShipmentTx(tx, {
          shippedAt: at, kind: CrmShipmentKind.SAMPLE, status: CrmShipmentStatus.DELIVERED,
          orgId, productId, quantity: d.quantity, sampleRequestId: id,
        })
        shipment = { code: created.code, quantity: d.quantity }
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
