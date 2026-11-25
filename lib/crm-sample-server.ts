// 샘플 전달 기록 — MCP record_sample 과 옴니스 AI 확인 카드가 같이 쓴다. 규칙은 lib/crm-sample-rules.ts.
//
// 화면(app/api/crm/samples · shipments)과 같은 모양으로 남긴다:
//   샘플요청 한 줄(발송완료) + 제품 · 수량이 있으면 샘플 출고 한 줄 + 그만큼 재고 출고.
// 출고와 재고를 한 트랜잭션에 두는 까닭은 shipments 라우트 주석 그대로다 — 따로 두면 「물건은 나갔는데 재고는 그대로」 가 된다.
import { prisma } from "@/lib/db"
import { gelLotsByProduct } from "@/lib/crm-gel-server"
import { gelShortWarning, lotMl, parseConc, parseMl, round3, variantLabel } from "@/lib/crm-gel"
import { writeActivity } from "@/lib/api"
import { nextCode, nextDatedCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import {
  parseSampleArgs, pickOrg, productLabel, productListLine, rankOrgs, resolveProduct, sampleRequestText, stockText, stockWarning,
  normalizeOrgName, normalizeUnits, productNameVariants,
  type ProductRow, type SampleArgs,
} from "@/lib/crm-sample-rules"

/** 이름 · 코드로 기관 찾기 — 기관 표는 작다(수십~수백). 전부 읽어 규칙으로 고른다 */
export async function findOrgsLoose(query: string, take = 5) {
  const all = await prisma.crmOrg.findMany({ select: { id: true, name: true, code: true } })
  return rankOrgs(query, all).slice(0, take)
}

/** CRM 제품 + 현재고(장부 IN − OUT). 보관(archived) 제품은 뺀다 */
export async function listProductsWithStock(): Promise<ProductRow[]> {
  const [products, sums] = await Promise.all([
    prisma.crmProduct.findMany({ where: { archived: false }, select: { id: true, code: true, name: true, spec: true, stockUnit: true, gelType: true }, orderBy: { code: "asc" } }),
    prisma.crmStockMove.groupBy({ by: ["productId", "direction"], _sum: { quantity: true } }),
  ])
  const bal = new Map<string, number>()
  for (const r of sums) {
    const q = Number(r._sum.quantity ?? 0) * (r.direction === "IN" ? 1 : -1)
    bal.set(r.productId, (bal.get(r.productId) ?? 0) + q)
  }
  const lots = await gelLotsByProduct(products.filter((p) => p.gelType).map((p) => p.id))
  return products.map((p) => ({
    id: p.id, code: p.code, name: p.name, spec: p.spec, unit: p.stockUnit,
    stock: Math.round((bal.get(p.id) ?? 0) * 1000) / 1000,
    gelType: p.gelType,
    ...(p.gelType ? { lots: lots.get(p.id) ?? [] } : {}),
  }))
}

/** list_products 도구의 답 — query 가 있으면 이름 · 별칭 · 규격 · 코드에 그 말이 든 것만 */
export async function productListText(query?: string): Promise<string> {
  const all = await listProductsWithStock()
  const q = query ? normalizeOrgName(normalizeUnits(query)) : ""
  const rows = q
    ? all.filter((p) => [...productNameVariants(p.name).map((n) => `${n}${p.spec ?? ""}`), p.code].some((k) => normalizeOrgName(k).includes(q) || q.includes(normalizeOrgName(k))))
    : all
  if (rows.length === 0) return q ? `'${query}' 에 맞는 제품이 없습니다. query 없이 불러 전체 목록을 보세요.` : "CRM 제품이 없습니다."
  return [
    `CRM 제품 ${rows.length}개 — record_sample 에는 product_id 를 넣으세요. 규격이 여럿이면 사용자에게 어느 것인지 물으세요.`,
    ...rows.map(productListLine),
  ].join("\n")
}

export interface PlanRow {
  label: string
  value: string
}

export interface SamplePlan {
  /** 실행해도 실패할 까닭 · 사용자에게 먼저 물어야 할 것. 있으면 쓰지 않는다 */
  problem?: string
  args?: SampleArgs
  org?: { id: string; name: string } | null
  /** 없는 기관을 새로 만든다(create_org=true 일 때만) */
  newOrgName?: string
  /** label: 화면 · 글에 쓰는 이름(젤이면 「애드젤 (ADD GEL) · 10% · 5ml」) */
  product?: { id: string; name: string; spec: string | null; label: string; gel: { conc: number; volumeMl: number | null } | null } | null
  /** 샘플 출고로 바뀌는 재고(제품 · 수량이 있을 때). 젤이면 그 농도 칸의 ml */
  stock?: { before: number; after: number; unit: ProductRow["unit"] } | null
  /** 재고가 0 이 되거나 모자랄 때 — 확인 카드 · 미리보기에 보인다 */
  warning?: string | null
  contact?: { id: string; name: string } | null
  rows: PlanRow[]
}

const ORG_TYPE_LABEL: Record<string, string> = { UNIVERSITY: "대학", RESEARCH: "연구원", COMPANY: "기업", HOSPITAL: "병원", OTHER: "기타" }

/** 무엇을 쓸지 — 아무것도 쓰지 않는다. 확인 카드 · MCP 의 confirm 전 답이 이것을 보여 준다 */
export async function planSampleDelivery(raw: Record<string, unknown>): Promise<SamplePlan> {
  const parsed = parseSampleArgs(raw)
  if (!parsed.ok) return { problem: parsed.error, rows: [] }
  const v = parsed.value

  const orgPick = pickOrg(await findOrgsLoose(v.org))
  let org: SamplePlan["org"] = null
  let newOrgName: string | undefined
  if (orgPick.kind === "one") org = { id: orgPick.org.id, name: orgPick.org.name }
  else if (orgPick.kind === "many") {
    return { args: v, rows: [], problem: `'${v.org}' 에 기관이 여럿 걸립니다: ${orgPick.candidates.map((o) => `${o.name}(${o.code})`).join(" / ")}. 어느 곳인지 사용자에게 묻고 정확한 이름으로 다시 부르세요.` }
  } else if (v.createOrg) newOrgName = v.org
  else {
    return {
      args: v, rows: [],
      problem: `'${v.org}' 기관이 CRM 에 없습니다. 새 기관으로 만들지 사용자에게 먼저 물으세요 — 그렇다고 하면 create_org=true(필요하면 org_type)로 다시 부릅니다. 이름이 다르게 적혀 있을 수 있으니 find_org 로 한 번 더 찾아봐도 됩니다.`,
    }
  }

  let product: SamplePlan["product"] = null
  let stock: SamplePlan["stock"] = null
  let warning: string | null = null
  if (v.productId || v.product) {
    const products = await listProductsWithStock()
    const r = resolveProduct(v, products)
    if ("problem" in r) return { args: v, rows: [], problem: r.problem }
    if (r.product) {
      const p = r.product
      let gel: { conc: number; volumeMl: number | null } | null = null
      if (p.gelType) {
        const c = parseConc(v.concentration)
        if ("problem" in c) return { args: v, rows: [], problem: `${p.name} 은 젤 타입이라 concentration(농도 %)이 필요합니다 — ${c.problem}` }
        // 젤 타입은 개수를 세지 않는다 — 보낸 ml 전체(volume_ml)만 받는다. quantity=1 은 같은 뜻이라 받아 준다
        if (v.quantity && v.quantity > 1) return { args: v, rows: [], problem: `${p.name} 은 젤 타입이라 개수를 세지 않습니다 — 보낸 ml 전체를 volume_ml 로 주세요(5ml 3개면 15).` }
        let vol: number | null = null
        if (v.volumeMl !== null && v.volumeMl !== undefined && v.volumeMl !== "") {
          const m = parseMl(v.volumeMl)
          if ("problem" in m) return { args: v, rows: [], problem: m.problem }
          vol = m.ml
        } else if (v.quantity) return { args: v, rows: [], problem: `${p.name} 은 젤 타입이라 샘플 출고를 적으려면 volume_ml(보낸 ml)이 필요합니다.` }
        gel = { conc: c.conc, volumeMl: vol }
      }
      product = { id: p.id, name: p.name, spec: p.spec, label: gel ? variantLabel(p.name, gel.conc, gel.volumeMl) : productLabel(p), gel }
      if (gel ? gel.volumeMl != null : v.quantity) {
        if (gel) {
          const before = lotMl(p.lots ?? [], gel.conc)
          const take = gel.volumeMl ?? 0
          stock = { before, after: round3(before - take), unit: "ML" }
          warning = gelShortWarning(variantLabel(p.name, gel.conc), before, take)
        } else {
          stock = { before: p.stock, after: Math.round((p.stock - v.quantity!) * 1000) / 1000, unit: p.unit }
          warning = stockWarning(p.stock, v.quantity!, p.unit)
        }
      }
    }
  }

  let contact: SamplePlan["contact"] = null
  if (v.contact && org) {
    const c = await prisma.crmContact.findFirst({ where: { orgId: org.id, name: { contains: v.contact, mode: "insensitive" } }, select: { id: true, name: true } })
    contact = c
  }

  const rows: PlanRow[] = [
    { label: "기관", value: org ? org.name : `${newOrgName} — 새로 만듭니다(${ORG_TYPE_LABEL[v.orgType]})` },
    { label: "전달일", value: v.date },
    { label: "요청사항", value: sampleRequestText(v, product, product?.gel ? null : v.quantity) },
    { label: "상태", value: "발송완료" },
  ]
  if (product) rows.push({ label: "제품", value: product.label })
  if (product && shipsSample(product, v.quantity)) rows.push({ label: "샘플 출고", value: `${product.label}${product.gel ? "" : ` ${v.quantity}개`} · 재고에서 뺍니다` })
  if (stock) rows.push({ label: "재고", value: `${stockText(stock.before, stock.unit)} → ${stockText(stock.after, stock.unit)}` })
  if (v.contact) rows.push({ label: "담당자", value: contact ? contact.name : `${v.contact} (CRM 담당자에 없어 비고에 적습니다)` })
  if (v.referral) rows.push({ label: "소개경로", value: v.referral })
  if (v.note) rows.push({ label: "비고", value: v.note })
  return { args: v, org, newOrgName, product, stock, warning, contact, rows }
}

/** 샘플 출고가 생기는가 — 젤 타입은 보낸 ml 가 있을 때, 아니면 수량이 있을 때 */
const shipsSample = (product: NonNullable<SamplePlan["product"]>, quantity: number | null) =>
  product.gel ? product.gel.volumeMl != null : Boolean(quantity)

export const planText = (plan: SamplePlan) =>
  [...plan.rows.map((r) => `- ${r.label}: ${r.value}`), plan.warning ? `⚠ ${plan.warning}` : null].filter(Boolean).join("\n")

/**
 * 쓴다. confirm 이 없으면 계획만 돌려준다 — MCP 에는 확인 카드가 없어서, 사용자에게 보여 주고
 * 동의를 받은 뒤 confirm=true 로 다시 부르게 한다. 옴니스 AI 는 확인 카드가 그 자리라 실행할 때 confirm 을 붙인다.
 */
export async function recordSampleDelivery(raw: Record<string, unknown>, userId: string): Promise<{ text: string } | { error: string }> {
  const plan = await planSampleDelivery(raw)
  if (plan.problem || !plan.args) return { error: plan.problem ?? "입력을 읽지 못했습니다." }
  if (!plan.args.confirm) {
    return { text: `아직 기록하지 않았습니다. 아래 내용을 사용자에게 보여 주고 동의를 받은 뒤 confirm=true 로 다시 부르세요.\n${planText(plan)}` }
  }
  const v = plan.args
  const at = new Date(`${v.date}T00:00:00Z`)
  const note = [v.note, v.contact && !plan.contact ? `담당자: ${v.contact}` : null].filter(Boolean).join("\n") || null

  const r = await createWithUniqueCode(() =>
    prisma.$transaction(async (tx) => {
      let orgId = plan.org?.id ?? null
      let orgCreated: { id: string; code: string; name: string } | null = null
      if (!orgId && plan.newOrgName) {
        // 계획과 실행 사이에 누가 같은 이름을 만들었으면 그것에 붙인다 — 같은 이름 기관이 둘이 되면 견적 · 계산서가 갈린다
        const dup = await tx.crmOrg.findUnique({ where: { name: plan.newOrgName }, select: { id: true } })
        if (dup) orgId = dup.id
        else {
          const codes = (await tx.crmOrg.findMany({ select: { code: true } })).map((o) => o.code)
          orgCreated = await tx.crmOrg.create({ data: { name: plan.newOrgName, type: v.orgType, code: nextCode("ORG", codes) }, select: { id: true, code: true, name: true } })
          orgId = orgCreated.id
        }
      }
      if (!orgId) throw new Error("기관을 정하지 못했습니다")
      const sampleCodes = (await tx.crmSampleRequest.findMany({ select: { code: true } })).map((s) => s.code)
      const sample = await tx.crmSampleRequest.create({
        data: {
          code: nextDatedCode(at, sampleCodes),
          requestedAt: at,
          orgId,
          contactId: plan.contact?.id ?? null,
          productId: plan.product?.id ?? null,
          ...(plan.product?.gel ? { concentrationPct: plan.product.gel.conc, volumeMl: plan.product.gel.volumeMl } : {}),
          request: sampleRequestText(v, plan.product ?? null, plan.product?.gel ? null : v.quantity),
          referral: v.referral,
          status: "SENT",
          sentAt: at,
          note,
        },
        select: { id: true, code: true },
      })
      let shipment: { id: string; code: string } | null = null
      if (plan.product && shipsSample(plan.product, v.quantity)) {
        const shipCodes = (await tx.crmShipment.findMany({ select: { code: true } })).map((s) => s.code)
        const gel = plan.product.gel && plan.product.gel.volumeMl != null ? { concentrationPct: plan.product.gel.conc, volumeMl: plan.product.gel.volumeMl } : null
        shipment = await tx.crmShipment.create({
          data: {
            code: nextCode("SH", shipCodes), shippedAt: at, kind: "SAMPLE", status: "DELIVERED",
            orgId, productId: plan.product.id, quantity: gel ? null : v.quantity, sampleRequestId: sample.id,
            ...(gel ?? {}),
          },
          select: { id: true, code: true },
        })
        await tx.crmStockMove.create({
          data: {
            movedAt: at, productId: plan.product.id, direction: "OUT", note: `출고 ${shipment.code}`, shipmentId: shipment.id,
            ...(gel ? { quantity: gel.volumeMl, concentrationPct: gel.concentrationPct } : { quantity: v.quantity! }),
          },
        })
      }
      return { sample, shipment, orgCreated, orgId }
    })
  )

  const orgName = plan.org?.name ?? plan.newOrgName ?? ""
  if (r.orgCreated) {
    await writeActivity({ userId, action: "create", entity: "crm.org", entityId: r.orgCreated.id, title: `기관 추가 ${r.orgCreated.code} ${r.orgCreated.name}`, metadata: { from: "record_sample" } })
  }
  await writeActivity({
    userId, action: "create", entity: "crm.sample", entityId: r.sample.id,
    title: `샘플 전달 ${r.sample.code} · ${orgName}`,
    metadata: {
      orgId: r.orgId, orgCreated: Boolean(r.orgCreated), productId: plan.product?.id ?? null,
      quantity: v.quantity, shipmentId: r.shipment?.id ?? null, date: v.date,
    },
  })
  return {
    text: [
      `기록했습니다: 샘플요청 ${r.sample.code} · ${orgName}${r.orgCreated ? ` (새 기관 ${r.orgCreated.code})` : ""}`,
      r.shipment ? `샘플 출고 ${r.shipment.code} · ${plan.product!.label} ${v.quantity}개 — 재고에서 뺐습니다` : null,
      "CRM › 샘플요청 에서 볼 수 있습니다.",
    ].filter(Boolean).join("\n"),
  }
}
