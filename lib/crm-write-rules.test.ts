/**
 * CRM 고치기 도구 — 계획(바뀌기 전 → 뒤 · 재고 변화 · 경고 · 할 일)을 DB 없이 스텁 CRM 으로 본다.
 * 쓰기는 화면 API 와 같은 lib/crm-ops.ts 가 한다(e2e: tests/feature/agent-crm-update-sample.spec.ts).
 * 기관 · 제품 이름은 지어낸 것이다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  crmPlanText, planCrmWrite, resolveOrgRef, type CrmOrgRow, type CrmPort, type CrmProductRow, type CrmProductionView, type CrmQuoteView, type CrmReceivableView, type CrmSampleView, type CrmShipmentView, type ProductionPreview,
} from "./crm-write-rules"
import { gelLots, gelMaterialGrams, parseConc, parseMl } from "./crm-gel"
import { TOOLS } from "./omnis-mcp"
import { agentToolSpecs } from "./agent/tools"
import { ROUTE_PREVIEW_TOOLS } from "./omnis-ask"
import { toolPolicy } from "./tools/registry"

const NOW = new Date("2026-11-18T03:00:00Z")
const P: CrmProductRow[] = [
  { id: "p-2ml", code: "PRD101", name: "시험젤 (TESTGEL)", spec: "2ml", stock: 10, unit: "PIECE", volumeMl: 2, concentrationPct: 1, unitPrice: 50000 },
  { id: "p-5ml", code: "PRD102", name: "시험젤 (TESTGEL)", spec: "5ml", stock: 2, unit: "PIECE" },
  { id: "p-raw", code: "PRD103", name: "시험원료", spec: null, stock: 0.05, unit: "GRAM", isMaterial: true },
  // 젤 타입 — 1% 칸 16ml, 10% 칸 5ml. 개수는 세지 않는다
  {
    id: "p-add", code: "PRD104", name: "애드젤 (ADD GEL)", spec: null, stock: 21, unit: "ML", gelType: "ADDGEL",
    lots: gelLots([
      { direction: "IN", quantity: 10, concentrationPct: 1 },
      { direction: "IN", quantity: 6, concentrationPct: 1 },
      { direction: "IN", quantity: 5, concentrationPct: 10 },
    ]),
  },
]
const O: CrmOrgRow[] = [
  { id: "o-1", code: "ORG101", name: "가나대학교", type: "UNIVERSITY", address: null, note: null, billingOrgId: null },
  { id: "o-2", code: "ORG102", name: "가나대학교 산학협력단", type: "UNIVERSITY", address: null, note: null, billingOrgId: null },
  { id: "o-3", code: "ORG103", name: "다라연구소", type: "RESEARCH", address: "서울", note: null, billingOrgId: null },
]
const S: CrmSampleView[] = [
  { id: "s-1", code: "HADD261117-001", date: "2026-11-17", org: { id: "o-3", name: "다라연구소" }, productId: "p-2ml", request: "시험젤 2ml 3개 샘플 전달", referral: null, note: null, sent: true, shipments: [{ id: "sh-1", code: "SH101", quantity: 3, productId: "p-2ml" }] },
  { id: "s-2", code: "HADD261117-002", date: "2026-11-17", org: { id: "o-3", name: "다라연구소" }, productId: null, request: "자료 요청", referral: null, note: null, sent: false, shipments: [] },
  // 젤 샘플 — 1% 4ml 를 보냈다(출고 ml, 개수 없음)
  {
    id: "s-3", code: "HADD261117-003", date: "2026-11-17", org: { id: "o-1", name: "가나대학교" }, productId: "p-add", request: "애드젤 1% 4ml", referral: null, note: null, sent: true,
    concentrationPct: 1, volumeMl: 4, shipments: [{ id: "sh-3", code: "SH103", quantity: null, productId: "p-add", concentrationPct: 1, volumeMl: 4 }],
  },
  { id: "s-4", code: "HADD261117-004", date: "2026-11-17", org: { id: "o-1", name: "가나대학교" }, productId: "p-add", request: "애드젤 10% 문의", referral: null, note: null, sent: false, concentrationPct: 10, volumeMl: null, shipments: [] },
]
const Q: CrmQuoteView[] = [
  { id: "q-1", code: "HADD261110-001", date: "2026-11-10", org: { id: "o-3", name: "다라연구소" }, status: "SENT", note: null, discount: 0, vatRate: 10, items: [{ productId: "p-2ml", label: "시험젤 (TESTGEL) 2ml", quantity: 2, unitPrice: 50000 }], shipments: 1, taxInvoices: 0 },
]
const RCV: CrmReceivableView[] = [
  { invoiceId: "inv-1", approvalNo: "20261110-0001", direction: "SALE", who: "다라연구소", issuedOn: "2026-11-10", total: 110000, paid: 50000, remaining: 60000 },
]
const port: CrmPort = {
  products: async () => P,
  orgs: async () => O,
  sample: async (ref) => S.find((s) => s.id === ref || s.code === ref) ?? null,
  quote: async (ref) => Q.find((q) => q.id === ref || q.code === ref) ?? null,
  receivable: async (ref) => RCV.find((r) => r.invoiceId === ref || r.approvalNo === ref) ?? null,
  production: async (ref) => MFG.find((m) => m.id === ref || m.code === ref) ?? null,
  shipment: async (ref) => SH.find((x) => x.id === ref || x.code === ref) ?? null,
  // 화면 · 쓰기와 같은 계산을 스텁으로 — 원료 0.05g, 원재료는 시험원료
  productionPreview: async (input, excludeId) => {
    const c = parseConc(input.concentrationPct)
    if ("problem" in c) return { problem: c.problem }
    const m = parseMl(input.totalMl)
    if ("problem" in m) return { problem: m.problem }
    const own = excludeId ? MFG.find((x) => x.id === excludeId) : null
    const totalMl = m.ml
    const materialGrams = input.materialId === "none" ? 0 : gelMaterialGrams(c.conc, totalMl)
    const before = 0.05 + (own?.materialGrams ?? 0)
    const pv: ProductionPreview = {
      productId: String(input.productId), productName: "애드젤 (ADD GEL)", conc: c.conc, totalMl,
      materialId: input.materialId === "none" ? null : "p-raw", materialName: input.materialId === "none" ? null : "시험원료",
      materialGrams, materialBefore: before, warnings: materialGrams > before ? ["원재료 시험원료 가 모자랍니다"] : [],
    }
    return pv
  },
}
const MFG: CrmProductionView[] = [
  {
    id: "m-1", code: "MFG101", date: "2026-11-17", productId: "p-add", productName: "애드젤 (ADD GEL)", concentrationPct: 1,
    totalMl: 10, materialId: "p-raw", materialName: "시험원료", materialGrams: 0.1, note: null, photoFileIds: [],
  },
]
const SH: CrmShipmentView[] = [
  // 애드젤 1% 4ml 판매 — 재고에 반영됨(1% 칸 16ml 은 이 출고를 뺀 뒤의 값)
  { id: "sh-10", code: "SH110", date: "2026-11-17", kind: "SALE", status: "DELIVERED", org: { id: "o-3", name: "다라연구소" }, productId: "p-add", concentrationPct: 1, volumeMl: 4, quantity: null, note: null, ledger: true, sampleCode: null },
  // 시험젤 2ml 2개 — 재고에 반영됨
  { id: "sh-11", code: "SH111", date: "2026-11-17", kind: "SALE", status: "SHIPPING", org: { id: "o-3", name: "다라연구소" }, productId: "p-2ml", concentrationPct: null, volumeMl: null, quantity: 2, note: null, ledger: true, sampleCode: null },
  // 엑셀에서 넘어온 지난 출고 — 장부 줄이 없다
  { id: "sh-12", code: "SH112", date: "2026-03-02", kind: "SALE", status: "DELIVERED", org: { id: "o-1", name: "가나대학교" }, productId: "p-add", concentrationPct: 1, volumeMl: 5, quantity: null, note: null, ledger: false, sampleCode: null },
  // 샘플요청에서 나온 출고
  { id: "sh-3", code: "SH103", date: "2026-11-17", kind: "SAMPLE", status: "DELIVERED", org: { id: "o-1", name: "가나대학교" }, productId: "p-add", concentrationPct: 1, volumeMl: 4, quantity: null, note: null, ledger: true, sampleCode: "HADD261117-003" },
]
const plan = (name: Parameters<typeof planCrmWrite>[0], args: Record<string, unknown>) => planCrmWrite(name, args, port, NOW)
const row = (p: Awaited<ReturnType<typeof plan>>, label: string) => p.changes.find((c) => c.label === label)

test("update_sample — 수량을 줄이면 출고 수량과 재고가 따라간다(재고 되돌림)", async () => {
  const p = await plan("update_sample", { sample_id: "s-1", quantity: 1 })
  assert.equal(p.problem, undefined)
  assert.deepEqual(row(p, "샘플 출고"), { label: "샘플 출고", before: "SH101 · 3개", after: "1개" })
  assert.deepEqual(row(p, "재고 · 시험젤 (TESTGEL) 2ml"), { label: "재고 · 시험젤 (TESTGEL) 2ml", before: "10개", after: "12개" })
  assert.deepEqual(p.op, { kind: "updateSample", id: "s-1", input: { quantity: 1 } })
  assert.equal(p.warning, null)
})

test("update_sample — 수량을 늘려 재고가 0 밑으로 가면 경고", async () => {
  const p = await plan("update_sample", { sample_id: "HADD261117-001", quantity: 15 })
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "-2개")
  assert.match(p.warning ?? "", /모자랍니다/)
})

test("update_sample — 제품을 바꾸면 원래 제품 재고가 돌아오고 새 제품에서 빠진다", async () => {
  const p = await plan("update_sample", { sample_id: "s-1", product_id: "PRD102" })
  assert.equal(row(p, "제품")?.after, "시험젤 (TESTGEL) 5ml")
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "13개")
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 5ml")?.after, "-1개")
  assert.match(p.warning ?? "", /모자랍니다/)
  assert.deepEqual(p.op, { kind: "updateSample", id: "s-1", input: { productId: "p-5ml" } })
})

test("update_sample — quantity=0 이면 샘플 출고를 지우고 재고를 되돌린다", async () => {
  const p = await plan("update_sample", { sample_id: "s-1", quantity: 0 })
  assert.equal(row(p, "샘플 출고")?.after, "지웁니다 — 재고가 돌아옵니다")
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "13개")
})

test("update_sample — 날짜 · 비고 · 발송 상태, 바뀌는 것이 없으면 막는다, 앞날은 안 된다", async () => {
  const p = await plan("update_sample", { sample_id: "s-2", date: "2026-11-16", note: "메일로 보냄", sent: true })
  assert.deepEqual(p.changes.map((c) => c.label), ["전달일", "비고", "상태"])
  assert.deepEqual(p.op, { kind: "updateSample", id: "s-2", input: { requestedAt: "2026-11-16", note: "메일로 보냄", sent: true } })
  assert.match((await plan("update_sample", { sample_id: "s-1", quantity: 3 })).problem ?? "", /바뀌는 것이 없습니다/)
  assert.match((await plan("update_sample", { sample_id: "s-1", date: "2026-12-01" })).problem ?? "", /오늘/)
  assert.match((await plan("update_sample", { sample_id: "없는거" })).problem ?? "", /list_samples/)
  // 제품 없는 요청에 수량만 — 출고를 만들 제품이 없다
  assert.match((await plan("update_sample", { sample_id: "s-2", quantity: 2 })).problem ?? "", /product_id/)
})

test("delete_sample — 지워질 내용과 재고 되돌림이 카드에 보인다 · keep_shipments 면 출고는 남는다", async () => {
  const p = await plan("delete_sample", { sample_id: "s-1" })
  assert.match(row(p, "지울 샘플요청")!.before!, /HADD261117-001 · 2026-11-17 · 다라연구소 · 시험젤 \(TESTGEL\) 2ml/)
  assert.equal(row(p, "샘플 출고")?.after, "지웁니다")
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "13개")
  assert.deepEqual(p.op, { kind: "deleteSample", id: "s-1", withShipments: true })
  const keep = await plan("delete_sample", { sample_id: "s-1", keep_shipments: true })
  assert.equal(row(keep, "샘플 출고")?.after, "남깁니다(연결만 끊김)")
  assert.equal(row(keep, "재고 · 시험젤 (TESTGEL) 2ml"), undefined)
  assert.deepEqual(keep.op, { kind: "deleteSample", id: "s-1", withShipments: false })
})

test("create_org — 같은 이름은 막고, 비슷한 이름은 경고한다", async () => {
  assert.match((await plan("create_org", { name: "가나대학교" })).problem ?? "", /이미 있습니다/)
  const p = await plan("create_org", { name: "가나대", org_type: "university" })
  assert.equal(p.problem, undefined)
  assert.match(p.warning ?? "", /가나대학교\(ORG101\)/)
  assert.deepEqual(p.op, { kind: "createOrg", input: { name: "가나대", type: "UNIVERSITY", address: null, note: null } })
  const fresh = await plan("create_org", { name: "마바병원", org_type: "HOSPITAL", address: "부산" })
  assert.equal(fresh.warning, null)
  assert.match((await plan("create_org", { name: "x", org_type: "SCHOOL" })).problem ?? "", /org_type/)
})

test("update_org — 코드로 고르고 전 → 뒤, 이름이 여럿 걸리면 후보를 돌려준다, 청구처 규칙", async () => {
  const p = await plan("update_org", { org: "ORG103", address: "대전", org_type: "COMPANY" })
  assert.deepEqual(p.changes, [
    { label: "종류", before: "연구원", after: "기업" },
    { label: "주소", before: "서울", after: "대전" },
  ])
  assert.deepEqual(p.op, { kind: "updateOrg", id: "o-3", input: { type: "COMPANY", address: "대전" } })
  assert.match((await plan("update_org", { org: "가나", note: "x" })).problem ?? "", /여럿 걸립니다: .*ORG101.*ORG102/)
  const billing = await plan("update_org", { org: "ORG101", billing_org: "ORG102" })
  assert.deepEqual(billing.op, { kind: "updateOrg", id: "o-1", input: { billingOrgId: "o-2" } })
  assert.match((await plan("update_org", { org: "ORG101", billing_org: "ORG101" })).problem ?? "", /자기 자신/)
  assert.match((await plan("update_org", { org: "ORG102", name: "가나대학교" })).problem ?? "", /이미 있습니다/)
})

test("record_stock — 입고 · 출고 · 실사 보정(차이만큼), 재고 경고", async () => {
  const inn = await plan("record_stock", { product_id: "p-2ml", mode: "in", quantity: 20, note: "입고" })
  assert.deepEqual(inn.op, { kind: "stockMove", input: { movedAt: "2026-11-18", productId: "p-2ml", direction: "IN", quantity: 20, note: "입고" } })
  assert.equal(row(inn, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "30개")
  const out = await plan("record_stock", { product_id: "PRD102", mode: "out", quantity: 2, note: "폐기" })
  assert.match(out.warning ?? "", /0 이 됩니다/)
  const count = await plan("record_stock", { product_id: "p-2ml", mode: "count", quantity: 7 })
  assert.equal(count.op?.kind === "stockMove" && count.op.input.direction, "OUT")
  assert.equal(count.op?.kind === "stockMove" && count.op.input.quantity, 3)
  assert.equal(row(count, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "7개")
  assert.match((await plan("record_stock", { product_id: "p-2ml", mode: "count", quantity: 10 })).problem ?? "", /맞출 것이 없습니다/)
  assert.match((await plan("record_stock", { product_id: "p-2ml", mode: "in", quantity: 1.5 })).problem ?? "", /정수/)
  assert.match((await plan("record_stock", { product_id: "zzz", mode: "in", quantity: 1 })).problem ?? "", /list_products/)
})

test("record_production — 젤 타입 · 농도 · 만든 ml, 그 농도 칸이 늘고 원재료가 농도/100 × ml 만큼 준다", async () => {
  const p = await plan("record_production", { type: "ADDGEL", concentration: 1, volume_ml: 25, note: "로트 A" })
  assert.equal(p.problem, undefined)
  assert.match(row(p, "생산")?.after ?? "", /애드젤 \(ADD GEL\) · 1% · 25ml/)
  assert.doesNotMatch(row(p, "생산")?.after ?? "", /×/)
  assert.deepEqual(row(p, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "41ml" })
  assert.match(row(p, "원재료 차감")?.after ?? "", /시험원료 0\.25g \(1% × 25ml, 농도는 g\/100ml\)/)
  assert.match(p.warning ?? "", /모자랍니다/) // 원료 0.05g < 0.25g — 막지 않고 경고
  assert.equal(p.op?.kind === "production" && p.op.input.totalMl, 25)
  assert.equal(p.op?.kind === "production" && "lines" in p.op.input, false)
  assert.match((await plan("record_production", { type: "ADDGEL", concentration: 25, volume_ml: 5 })).problem ?? "", /0\.5 ~ 20/)
  assert.match((await plan("record_production", { type: "ADDGEL", concentration: 1 })).problem ?? "", /volume_ml/)
  assert.match((await plan("record_production", { type: "고정제", concentration: 1, volume_ml: 1 })).problem ?? "", /ADDGEL/)
  assert.match((await plan("record_production", { type: "ADDGEL", concentration: 1, volume_ml: -1 })).problem ?? "", /0보다/)
  assert.equal((await plan("record_production", { type: "애드젤", concentration: "10%", volume_ml: "5ml" })).problem, undefined)
})

test("update_production · delete_production — 이 생산분을 거두고 다시 계산, 지우면 되돌린다", async () => {
  const u = await plan("update_production", { production_id: "MFG101", volume_ml: 20 })
  assert.equal(u.problem, undefined)
  assert.deepEqual(row(u, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "26ml" })
  assert.deepEqual(row(u, "원재료 차감"), { label: "원재료 차감", before: "시험원료 0.1g", after: "시험원료 0.2g" })
  assert.equal(u.op?.kind, "updateProduction")
  // 농도를 옮기면 1% 칸에서 빠지고 10% 칸에 더해진다
  const moved = await plan("update_production", { production_id: "m-1", concentration: 10 })
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "6ml")
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 10%")?.after, "15ml")
  assert.match((await plan("update_production", { production_id: "MFG101", volume_ml: 10 })).problem ?? "", /바뀌는 것이 없습니다/)
  assert.match((await plan("update_production", { production_id: "없음" })).problem ?? "", /list_productions/)
  const d = await plan("delete_production", { production_id: "MFG101" })
  assert.deepEqual(row(d, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "6ml" })
  assert.deepEqual(row(d, "재고 · 시험원료"), { label: "재고 · 시험원료", before: "0.05g", after: "0.15g" })
  assert.deepEqual(d.op, { kind: "deleteProduction", id: "m-1" })
})

test("젤 타입 출고 · 재고 맞추기 — 개수 없이 ml 로 빠진다. 견적만 개수 × 단가", async () => {
  const sh = await plan("record_shipment", { org: "ORG103", product_id: "PRD104", concentration: 1, volume_ml: 10 })
  assert.equal(sh.problem, undefined)
  assert.deepEqual(row(sh, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "6ml" })
  assert.match(row(sh, "출하")?.after ?? "", /애드젤 \(ADD GEL\) · 1% · 10ml · 판매/)
  assert.doesNotMatch(row(sh, "출하")?.after ?? "", /개/)
  assert.equal(sh.op?.kind === "shipment" && sh.op.input.volumeMl, 10)
  assert.equal(sh.op?.kind === "shipment" && sh.op.input.quantity, null)
  // 개수를 주면 ml 전체로 다시 적게 한다(1 은 같은 뜻이라 받는다)
  assert.match((await plan("record_shipment", { org: "ORG103", product_id: "p-add", quantity: 3, concentration: 1, volume_ml: 5 })).problem ?? "", /개수를 세지 않습니다/)
  assert.equal((await plan("record_shipment", { org: "ORG103", product_id: "p-add", quantity: 1, concentration: 1, volume_ml: 5 })).problem, undefined)
  assert.match((await plan("record_shipment", { org: "ORG103", product_id: "p-add" })).problem ?? "", /concentration/)
  assert.match((await plan("record_shipment", { org: "ORG103", product_id: "p-add", concentration: 1 })).problem ?? "", /volume_ml/)
  assert.match((await plan("record_shipment", { org: "ORG103", product_id: "p-2ml" })).problem ?? "", /quantity/)
  const short = await plan("record_shipment", { org: "ORG103", product_id: "p-add", concentration: 10, volume_ml: 10 })
  assert.match(short.warning ?? "", /모자랍니다/)
  const cnt = await plan("record_stock", { product_id: "p-add", mode: "count", quantity: 12, concentration: 1 })
  assert.equal(cnt.op?.kind === "stockMove" && cnt.op.input.direction, "OUT")
  assert.equal(cnt.op?.kind === "stockMove" && cnt.op.input.quantity, 4)
  const inn = await plan("record_stock", { product_id: "p-add", mode: "in", quantity: 6, concentration: 2 })
  assert.equal(row(inn, "재고 · 애드젤 (ADD GEL) · 2%")?.after, "6ml")
  assert.deepEqual(inn.op?.kind === "stockMove" && Object.keys(inn.op.input).sort(), ["concentrationPct", "direction", "movedAt", "note", "productId", "quantity"])
  const q = await plan("create_quote", { org: "ORG103", items: [{ product_id: "p-add", quantity: 2, unit_price: 100000, concentration: 10, volume_ml: 5 }] })
  assert.equal(q.problem, undefined)
  assert.match(row(q, "품목 1")?.after ?? "", /애드젤 \(ADD GEL\) · 10% · 5ml 2개/)
  assert.match((await plan("create_quote", { org: "ORG103", items: [{ product_id: "p-add", quantity: 1, concentration: 10, volume_ml: 5 }] })).problem ?? "", /unit_price/)
})

test("update_sample · delete_sample (젤) — 보낸 ml 로 고치고, 개수는 받지 않는다", async () => {
  const p = await plan("update_sample", { sample_id: "s-3", volume_ml: 6 })
  assert.equal(p.problem, undefined)
  assert.deepEqual(row(p, "샘플 출고"), { label: "샘플 출고", before: "SH103 · 4ml", after: "6ml" })
  assert.deepEqual(row(p, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "14ml" })
  assert.equal(p.op?.kind === "updateSample" && p.op.input.volumeMl, 6)
  assert.match((await plan("update_sample", { sample_id: "s-3", quantity: 2 })).problem ?? "", /개수를 세지 않습니다/)
  // 농도를 옮기면 1% 칸이 돌아오고 10% 칸에서 빠진다
  const moved = await plan("update_sample", { sample_id: "s-3", concentration: 10 })
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "20ml")
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 10%")?.after, "1ml")
  // 출고가 없던 젤 샘플에 ml 를 주면 샘플 출고를 새로 남긴다
  const made = await plan("update_sample", { sample_id: "s-4", volume_ml: 2 })
  assert.match(row(made, "샘플 출고")?.after ?? "", /10% · 2ml — 새로 남깁니다/)
  assert.equal(row(made, "재고 · 애드젤 (ADD GEL) · 10%")?.after, "3ml")
  const z = await plan("update_sample", { sample_id: "s-3", quantity: 0 })
  assert.match(row(z, "샘플 출고")?.after ?? "", /지웁니다/)
  assert.equal(row(z, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "20ml")
  const d = await plan("delete_sample", { sample_id: "s-3" })
  assert.equal(row(d, "샘플 출고")?.before, "SH103 · 애드젤 (ADD GEL) · 1% · 4ml")
  assert.equal(row(d, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "20ml")
})

test("기관 고르기 — id · 코드는 정확히, 이름은 find_org 와 같은 규칙", () => {
  const byCode = resolveOrgRef("org103", O)
  assert.equal("org" in byCode && byCode.org.id, "o-3")
  assert.equal("org" in resolveOrgRef("o-2", O), true)
  const none = resolveOrgRef("없는기관", O)
  assert.match("problem" in none ? none.problem : "", /create_org/)
})

test("미리보기 글 — 전 → 뒤 · 경고가 보인다", async () => {
  const t = crmPlanText(await plan("update_sample", { sample_id: "s-1", quantity: 15 }))
  assert.match(t, /- 샘플 출고: SH101 · 3개 → 15개/)
  assert.match(t, /⚠ 재고가 모자랍니다/)
})

/** 모델 스텁 — list_samples 줄에서 sample_id 를 골라 update_sample 을 부른다(실제 모델이 할 일을 흉내) */
test("모델 스텁 — 목록에서 ID 를 골라 고친다, 후보가 여럿이면 묻는다", async () => {
  const lines = S.map((s) => `- sample_id=${s.id} · ${s.code} · ${s.date} · ${s.org.name}`)
  const pick = (said: string) => lines.filter((l) => l.includes(said)).map((l) => /sample_id=([^ ]+)/.exec(l)![1])
  assert.deepEqual(pick("다라연구소"), ["s-1", "s-2"]) // 여럿 → 부르지 않고 묻는다
  const [id] = pick("HADD261117-001")
  const p = await plan("update_sample", { sample_id: id, quantity: 2 })
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "11개")
})

test("create_quote — 품목 · 합계(부가세 10%) · 기본 단가, 단가가 없으면 묻는다", async () => {
  const p = await plan("create_quote", { org: "ORG103", items: [{ product_id: "p-2ml", quantity: 2 }, { product_id: "PRD102", quantity: 1, unit_price: 80000 }], discount: 10000 })
  assert.equal(p.problem, undefined)
  assert.equal(row(p, "품목 1")?.after, "시험젤 (TESTGEL) 2ml 2개 × 50,000원 = 100,000원")
  assert.equal(row(p, "공급가")?.after, "180,000원")
  assert.equal(row(p, "부가세")?.after, "17,000원")
  assert.equal(row(p, "합계")?.after, "187,000원")
  assert.deepEqual(p.op, { kind: "createQuote", input: { quotedAt: "2026-11-18", orgId: "o-3", discountAmount: 10000, status: "DRAFT", note: null, items: [{ productId: "p-2ml", quantity: 2, unitPrice: 50000 }, { productId: "p-5ml", quantity: 1, unitPrice: 80000 }] } })
  assert.match((await plan("create_quote", { org: "ORG103", items: [{ product_id: "p-5ml", quantity: 1 }] })).problem ?? "", /기본 단가가 없습니다/)
  assert.match((await plan("create_quote", { org: "ORG103", items: [] })).problem ?? "", /items/)
  assert.match((await plan("create_quote", { org: "ORG103", items: [{ product_id: "p-2ml", quantity: 1 }], status: "DONE" })).problem ?? "", /DRAFT/)
})

test("update_quote · delete_quote — 상태 전 → 뒤, 완료면 재무 알림을 알린다, 지우기는 품목 · 합계 · 남는 것", async () => {
  const p = await plan("update_quote", { quote_id: "HADD261110-001", status: "DONE" })
  assert.deepEqual(p.changes, [{ label: "상태", before: "발송", after: "완료" }])
  assert.match(p.risk, /재무 담당/)
  assert.deepEqual(p.op, { kind: "updateQuote", id: "q-1", input: { status: "DONE" } })
  assert.match((await plan("update_quote", { quote_id: "q-1", status: "SENT" })).problem ?? "", /바뀌는 것이 없습니다/)
  const d = await plan("delete_quote", { quote_id: "q-1" })
  assert.equal(row(d, "품목 1")?.before, "시험젤 (TESTGEL) 2ml 2개 × 50,000원")
  assert.equal(row(d, "합계")?.before, "110,000원")
  assert.match(d.risk, /출고 1건은 남고/)
  assert.deepEqual(d.op, { kind: "deleteQuote", id: "q-1" })
})

test("record_shipment — 재고가 빠지고 모자라면 경고, 다른 기관의 견적은 막는다", async () => {
  const p = await plan("record_shipment", { org: "ORG103", product_id: "PRD102", quantity: 3, quote_id: "q-1" })
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 5ml")?.after, "-1개")
  assert.match(p.warning ?? "", /모자랍니다/)
  assert.deepEqual(p.op, { kind: "shipment", input: { shippedAt: "2026-11-18", kind: "SALE", orgId: "o-3", productId: "p-5ml", quantity: 3, status: "DELIVERED", quoteId: "q-1", note: null } })
  assert.match((await plan("record_shipment", { org: "ORG101", product_id: "p-2ml", quantity: 1, quote_id: "q-1" })).problem ?? "", /기관이 다릅니다/)
  assert.match((await plan("record_shipment", { org: "ORG103", product_id: "p-2ml", quantity: 1, kind: "RENT" })).problem ?? "", /kind/)
})

test("update_shipment — 생산처럼 이 출고분을 돌려놓고 다시 뺀다(ml · 농도 칸 옮기기 · 개수), 미반영 출고는 재고가 그대로", async () => {
  const u = await plan("update_shipment", { shipment_id: "SH110", volume_ml: 6 })
  assert.equal(u.problem, undefined)
  // 4ml 를 돌려놓고 6ml 를 뺀다 — 16 → 14
  assert.deepEqual(row(u, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "14ml" })
  assert.match(row(u, "출고")?.before ?? "", /SH110 · .*1% · 4ml/)
  assert.match(row(u, "출고")?.after ?? "", /1% · 6ml · 판매/)
  assert.deepEqual(u.op, { kind: "updateShipment", id: "sh-10", input: { volumeMl: 6, concentrationPct: 1 } })
  // 농도를 옮기면 1% 칸에 돌아오고 10% 칸에서 빠진다(10% 는 5ml 뿐이라 경고)
  const moved = await plan("update_shipment", { shipment_id: "sh-10", concentration: 10, volume_ml: 6 })
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "20ml")
  assert.equal(row(moved, "재고 · 애드젤 (ADD GEL) · 10%")?.after, "-1ml")
  assert.match(moved.warning ?? "", /모자랍니다/)
  // 기관 · 날짜 · 유형만 바꾸면 재고 줄은 안 보인다
  const meta = await plan("update_shipment", { shipment_id: "SH110", org: "ORG101", kind: "GIFT", date: "2026-11-16" })
  assert.equal(meta.problem, undefined)
  assert.equal(meta.changes.some((c) => c.label.startsWith("재고")), false)
  assert.deepEqual(meta.op, { kind: "updateShipment", id: "sh-10", input: { orgId: "o-1", shippedAt: "2026-11-16", kind: "GIFT" } })
  // 젤이 아닌 출고는 개수로 — 2개 → 3개면 재고 10 → 9
  const piece = await plan("update_shipment", { shipment_id: "SH111", quantity: 3, status: "DELIVERED" })
  assert.equal(row(piece, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "9개")
  assert.match((await plan("update_shipment", { shipment_id: "SH111", volume_ml: 3 })).problem ?? "", /젤 타입.*에만/)
  assert.match((await plan("update_shipment", { shipment_id: "SH110", quantity: 3 })).problem ?? "", /개수를 세지 않습니다/)
  // 젤 → 개수 제품으로 옮기면 개수가 있어야 한다
  assert.match((await plan("update_shipment", { shipment_id: "SH110", product_id: "PRD101" })).problem ?? "", /quantity/)
  const swap = await plan("update_shipment", { shipment_id: "SH110", product_id: "PRD101", quantity: 1 })
  assert.equal(row(swap, "재고 · 애드젤 (ADD GEL) · 1%")?.after, "20ml")
  assert.equal(row(swap, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "9개")
  // 미반영 출고 — 재고는 그대로라고 보인다
  const legacy = await plan("update_shipment", { shipment_id: "SH112", volume_ml: 3 })
  assert.equal(legacy.changes.filter((c) => c.label.startsWith("재고 · ")).length, 0)
  assert.match(row(legacy, "재고")?.after ?? "", /미반영/)
  // 샘플요청에서 나온 출고의 기관 · 제품은 샘플요청에서
  assert.match((await plan("update_shipment", { shipment_id: "SH103", org: "ORG103" })).problem ?? "", /update_sample/)
  assert.match((await plan("update_shipment", { shipment_id: "SH110", volume_ml: 4 })).problem ?? "", /바뀌는 것이 없습니다/)
  assert.match((await plan("update_shipment", { shipment_id: "없음" })).problem ?? "", /list_shipments/)
})

test("delete_shipment — 재고가 출고 전으로 돌아온다, 미반영 출고는 그대로", async () => {
  const d = await plan("delete_shipment", { shipment_id: "SH110" })
  assert.deepEqual(row(d, "재고 · 애드젤 (ADD GEL) · 1%"), { label: "재고 · 애드젤 (ADD GEL) · 1%", before: "16ml", after: "20ml" })
  assert.deepEqual(d.op, { kind: "deleteShipment", id: "sh-10" })
  assert.equal(d.done?.entity, "crm.shipment")
  const legacy = await plan("delete_shipment", { shipment_id: "SH112" })
  assert.match(row(legacy, "재고")?.after ?? "", /미반영/)
  assert.match(row(await plan("delete_shipment", { shipment_id: "SH103" }), "샘플요청")?.after ?? "", /HADD261117-003 는 남고/)
})

test("record_payment — 받은 · 남은 금액 전 → 뒤, 남은 금액보다 많으면 막는다", async () => {
  const p = await plan("record_payment", { invoice_id: "inv-1", amount: 60000, note: "입금자 다라" })
  assert.deepEqual(row(p, "남은 금액"), { label: "남은 금액", before: "60,000원", after: "0원" })
  assert.deepEqual(row(p, "받은 금액"), { label: "받은 금액", before: "50,000원", after: "110,000원" })
  assert.deepEqual(p.op, { kind: "payment", input: { invoiceId: "inv-1", paidOn: "2026-11-18", amountKrw: 60000, note: "입금자 다라" } })
  assert.match((await plan("record_payment", { invoice_id: "20261110-0001", amount: 70000 })).problem ?? "", /남은 금액\(60,000원\)보다 많습니다/)
  assert.match((await plan("record_payment", { invoice_id: "없음", amount: 1 })).problem ?? "", /list_receivables/)
})

test("레지스트리 — CRM 쓰기는 MCP confirm · 앱 AI 확인 카드(confirm 칸 없음) · 질문 경로 미리보기", async () => {
  const specs = await agentToolSpecs()
  for (const name of ["update_sample", "delete_sample", "create_org", "update_org", "record_stock", "record_production", "update_production", "delete_production", "create_quote", "update_quote", "delete_quote", "record_shipment", "update_shipment", "delete_shipment", "record_payment"]) {
    const p = toolPolicy(name)!
    assert.equal(p.mcp, true, name)
    assert.equal(p.agent, "write", name)
    assert.equal(p.ask, "preview", name)
    assert.equal(p.confirm, "param", name)
    assert.ok(ROUTE_PREVIEW_TOOLS.has(name), name)
    const mcp = TOOLS.find((t) => t.name === name)!.inputSchema as { properties: Record<string, unknown> }
    assert.ok("confirm" in mcp.properties, `${name} MCP 에 confirm`)
    const spec = specs.find((s) => s.name === name)!
    assert.equal(spec.risk, "write")
    assert.equal("confirm" in ((spec.schema as { properties: Record<string, unknown> }).properties), false, `${name} 앱 AI 에는 confirm 이 없다`)
  }
  for (const name of ["list_samples", "list_quotes", "list_receivables", "list_productions", "list_shipments"]) {
    assert.equal(toolPolicy(name)!.agent, "read", name)
    assert.equal(toolPolicy(name)!.ask, "read", name)
  }
})
