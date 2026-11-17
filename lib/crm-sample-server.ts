// 샘플 전달 기록 — MCP record_sample 과 옴니스 AI 확인 카드가 같이 쓴다. 규칙은 lib/crm-sample-rules.ts.
//
// 화면(app/api/crm/samples · shipments)과 같은 모양으로 남긴다:
//   샘플요청 한 줄(발송완료) + 제품 · 수량이 있으면 샘플 출고 한 줄 + 그만큼 재고 출고.
// 출고와 재고를 한 트랜잭션에 두는 까닭은 shipments 라우트 주석 그대로다 — 따로 두면 「물건은 나갔는데 재고는 그대로」 가 된다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { nextCode, nextDatedCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"
import {
  parseSampleArgs, pickOrg, pickProduct, productLabel, rankOrgs, sampleRequestText,
  type SampleArgs,
} from "@/lib/crm-sample-rules"

/** 이름 · 코드로 기관 찾기 — 기관 표는 작다(수십~수백). 전부 읽어 규칙으로 고른다 */
export async function findOrgsLoose(query: string, take = 5) {
  const all = await prisma.crmOrg.findMany({ select: { id: true, name: true, code: true } })
  return rankOrgs(query, all).slice(0, take)
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
  product?: { id: string; name: string; spec: string | null } | null
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
  if (v.product) {
    const products = await prisma.crmProduct.findMany({
      where: { archived: false }, select: { id: true, name: true, spec: true }, orderBy: { code: "asc" },
    })
    const p = pickProduct(v.product, products)
    if (p.kind === "many") return { args: v, rows: [], problem: `'${v.product}' 에 제품이 여럿 걸립니다: ${p.candidates.map(productLabel).join(" / ")}. 규격까지 적어 다시 부르세요.` }
    if (p.kind === "none") return { args: v, rows: [], problem: `'${v.product}' 제품이 CRM 제품 목록에 없습니다. 목록에 있는 이름으로 다시 부르거나, 제품 없이 content 에 적어 남기세요.` }
    product = p.product
  }

  let contact: SamplePlan["contact"] = null
  if (v.contact && org) {
    const c = await prisma.crmContact.findFirst({ where: { orgId: org.id, name: { contains: v.contact, mode: "insensitive" } }, select: { id: true, name: true } })
    contact = c
  }

  const rows: PlanRow[] = [
    { label: "기관", value: org ? org.name : `${newOrgName} — 새로 만듭니다(${ORG_TYPE_LABEL[v.orgType]})` },
    { label: "전달일", value: v.date },
    { label: "요청사항", value: sampleRequestText(v, product, v.quantity) },
    { label: "상태", value: "발송완료" },
  ]
  if (product) rows.push({ label: "제품", value: productLabel(product) })
  if (product && v.quantity) rows.push({ label: "샘플 출고", value: `${productLabel(product)} ${v.quantity}개 · 재고에서 뺍니다` })
  if (v.contact) rows.push({ label: "담당자", value: contact ? contact.name : `${v.contact} (CRM 담당자에 없어 비고에 적습니다)` })
  if (v.referral) rows.push({ label: "소개경로", value: v.referral })
  if (v.note) rows.push({ label: "비고", value: v.note })
  return { args: v, org, newOrgName, product, contact, rows }
}

export const planText = (plan: SamplePlan) => plan.rows.map((r) => `- ${r.label}: ${r.value}`).join("\n")

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
          request: sampleRequestText(v, plan.product ?? null, v.quantity),
          referral: v.referral,
          status: "SENT",
          sentAt: at,
          note,
        },
        select: { id: true, code: true },
      })
      let shipment: { id: string; code: string } | null = null
      if (plan.product && v.quantity) {
        const shipCodes = (await tx.crmShipment.findMany({ select: { code: true } })).map((s) => s.code)
        shipment = await tx.crmShipment.create({
          data: {
            code: nextCode("SH", shipCodes), shippedAt: at, kind: "SAMPLE", status: "DELIVERED",
            orgId, productId: plan.product.id, quantity: v.quantity, sampleRequestId: sample.id,
          },
          select: { id: true, code: true },
        })
        await tx.crmStockMove.create({
          data: { movedAt: at, productId: plan.product.id, direction: "OUT", quantity: v.quantity, note: `출고 ${shipment.code}`, shipmentId: shipment.id },
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
      r.shipment ? `샘플 출고 ${r.shipment.code} · ${productLabel(plan.product!)} ${v.quantity}개 — 재고에서 뺐습니다` : null,
      "CRM › 샘플요청 에서 볼 수 있습니다.",
    ].filter(Boolean).join("\n"),
  }
}
