// CRM 고치기 도구의 서버 쪽 — 계획(lib/crm-write-rules.ts)에 DB 를 붙이고, 확인되면 화면 API 와 같은 함수(lib/crm-ops.ts)로 쓴다.
// MCP runTool · 앱 AI 확인 카드(lib/agent/tools.ts) · 질문 경로 미리보기가 모두 여기를 지난다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { normalizeOrgName } from "@/lib/crm-sample-rules"
import { listProductsWithStock } from "@/lib/crm-sample-server"
import { createOrg, createProduction, createStockMove, deleteSampleRequest, updateOrg, updateSampleRequest, type OpResult } from "@/lib/crm-ops"
import { crmPlanText, planCrmWrite, type CrmOp, type CrmPlan, type CrmPort, type CrmSampleView, type CrmWriteToolName } from "@/lib/crm-write-rules"

const kst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10)

async function sampleView(ref: string): Promise<CrmSampleView | null> {
  const key = ref.trim()
  const uuid = /^[0-9a-f-]{36}$/i.test(key)
  const s = await prisma.crmSampleRequest.findFirst({
    where: uuid ? { id: key } : { code: { equals: key, mode: "insensitive" } },
    include: { org: { select: { id: true, name: true } }, shipments: { select: { id: true, code: true, quantity: true, productId: true }, orderBy: { createdAt: "asc" } } },
  })
  if (!s) return null
  return {
    id: s.id, code: s.code, date: kst(s.requestedAt), org: s.org, productId: s.productId,
    request: s.request, referral: s.referral, note: s.note, sent: s.status === "SENT", shipments: s.shipments,
  }
}

/** 계획이 읽는 CRM — 운영 DB */
export const prismaCrmPort: CrmPort = {
  async products() {
    const [rows, extra] = await Promise.all([
      listProductsWithStock(),
      prisma.crmProduct.findMany({ where: { archived: false }, select: { id: true, isMaterial: true, volumeMl: true, concentrationPct: true } }),
    ])
    const by = new Map(extra.map((e) => [e.id, e]))
    return rows.map((r) => {
      const e = by.get(r.id)
      return { ...r, isMaterial: e?.isMaterial ?? false, volumeMl: e?.volumeMl ? Number(e.volumeMl) : null, concentrationPct: e?.concentrationPct ? Number(e.concentrationPct) : null }
    })
  },
  orgs: () => prisma.crmOrg.findMany({ select: { id: true, code: true, name: true, type: true, address: true, note: true, billingOrgId: true } }),
  sample: sampleView,
}

export const planCrm = (name: CrmWriteToolName, args: Record<string, unknown>) => planCrmWrite(name, args, prismaCrmPort)

async function runOp(op: CrmOp): Promise<OpResult<{ id: string; text: string }>> {
  switch (op.kind) {
    case "updateSample": {
      const r = await updateSampleRequest(op.id, op.input)
      if (!r.ok) return r
      const v = r.value
      return { ok: true, value: { id: op.id, text: [
        `고쳤습니다: 샘플요청 ${v.code}`,
        v.shipment ? `샘플 출고 ${v.shipment.code} · ${v.shipment.quantity}개 — 재고가 따라 바뀌었습니다` : null,
        v.removedShipment ? `샘플 출고 ${v.removedShipment} 를 지웠습니다 — 재고가 돌아왔습니다` : null,
      ].filter(Boolean).join("\n") } }
    }
    case "deleteSample": {
      const r = await deleteSampleRequest(op.id, { withShipments: op.withShipments })
      if (!r.ok) return r
      return { ok: true, value: { id: op.id, text: [
        `지웠습니다: 샘플요청 ${r.value.code}`,
        r.value.shipments.length ? `샘플 출고 ${r.value.shipments.join(", ")} 도 지워 재고가 돌아왔습니다` : null,
      ].filter(Boolean).join("\n") } }
    }
    case "createOrg": {
      const r = await createOrg(op.input)
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `만들었습니다: 기관 ${r.value.code} ${r.value.name}` } }
    }
    case "updateOrg": {
      const r = await updateOrg(op.id, op.input)
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `고쳤습니다: 기관 ${r.value.code} ${r.value.name}` } }
    }
    case "stockMove": {
      const r = await createStockMove({ ...op.input, movedAt: `${op.input.movedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: "재고 장부에 적었습니다." } }
    }
    case "production": {
      const r = await createProduction({ ...op.input, producedAt: `${op.input.producedAt}T00:00:00Z` })
      if (!r.ok) return r
      return { ok: true, value: { id: r.value.id, text: `생산 ${r.value.code} 를 남겼습니다 — 완제품 재고가 늘고 원료가 줄었습니다.` } }
    }
  }
}

/**
 * CRM 고치기 도구 실행. confirm 이 없으면 계획만 돌려준다(MCP · 질문 경로 미리보기).
 * 앱 AI 는 확인 카드를 누른 뒤 confirm=true 로 여기를 부른다 — 계획을 다시 세워 그 사이 바뀐 것을 반영한다.
 */
export async function runCrmWrite(name: CrmWriteToolName, args: Record<string, unknown>, userId: string): Promise<{ text: string } | { error: string }> {
  const plan = await planCrm(name, args)
  if (plan.problem || !plan.op) return { error: plan.problem ?? "입력을 읽지 못했습니다." }
  if (args.confirm !== true) {
    return { text: `아직 쓰지 않았습니다. 아래 내용을 사용자에게 보여 주고 동의를 받은 뒤 confirm=true 로 다시 부르세요.\n${crmPlanText(plan)}` }
  }
  const r = await runOp(plan.op)
  if (!r.ok) return { error: r.error }
  if (plan.done) {
    await writeActivity({
      userId, action: plan.done.action, entity: plan.done.entity, entityId: r.value.id, title: plan.done.title,
      metadata: { from: name, changes: plan.changes.map((c) => ({ label: c.label, before: c.before, after: c.after })) },
    })
  }
  return { text: `${r.value.text}\n${plan.changes.map((c) => `- ${c.label}: ${c.before !== null ? `${c.before} → ${c.after}` : c.after}`).join("\n")}` }
}

export type { CrmPlan }

/** list_samples — sample_id 를 여기서 고른다 */
export async function sampleListText(query?: string, limit = 20): Promise<string> {
  const take = Math.min(Math.max(limit || 20, 1), 50)
  const rows = await prisma.crmSampleRequest.findMany({
    orderBy: [{ requestedAt: "desc" }, { createdAt: "desc" }],
    take: query ? 500 : take,
    include: {
      org: { select: { name: true, code: true } },
      product: { select: { name: true, spec: true } },
      shipments: { select: { code: true, quantity: true, product: { select: { name: true, spec: true } } } },
    },
  })
  const q = query ? normalizeOrgName(query) : ""
  const hit = q
    ? rows.filter((s) => [s.code, s.org.name, s.org.code, s.product ? `${s.product.name}${s.product.spec ?? ""}` : "", s.request ?? ""].some((k) => normalizeOrgName(k).includes(q))).slice(0, take)
    : rows
  if (hit.length === 0) return query ? `'${query}' 에 맞는 샘플요청이 없습니다.` : "샘플요청이 없습니다."
  return [
    `샘플요청 ${hit.length}건(최근 것부터) — 고치기 · 지우기는 sample_id 로(update_sample · delete_sample).`,
    ...hit.map((s) => [
      `- sample_id=${s.id}`, s.code, kst(s.requestedAt), `${s.org.name}(${s.org.code})`,
      s.product ? `${s.product.name}${s.product.spec ? ` ${s.product.spec}` : ""}` : "제품 없음",
      s.shipments.length ? `출고 ${s.shipments.map((x) => `${x.code} ${x.quantity}개`).join(", ")}` : "출고 없음",
      s.status === "SENT" ? "발송완료" : "미발송",
      s.request ? `요청 ${s.request.slice(0, 60)}` : null,
    ].filter(Boolean).join(" · ")),
  ].join("\n")
}
