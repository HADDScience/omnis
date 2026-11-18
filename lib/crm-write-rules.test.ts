/**
 * CRM 고치기 도구 — 계획(바뀌기 전 → 뒤 · 재고 변화 · 경고 · 할 일)을 DB 없이 스텁 CRM 으로 본다.
 * 쓰기는 화면 API 와 같은 lib/crm-ops.ts 가 한다(e2e: tests/feature/agent-crm-update-sample.spec.ts).
 * 기관 · 제품 이름은 지어낸 것이다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { crmPlanText, planCrmWrite, resolveOrgRef, type CrmOrgRow, type CrmPort, type CrmProductRow, type CrmSampleView } from "./crm-write-rules"
import { TOOLS } from "./omnis-mcp"
import { agentToolSpecs } from "./agent/tools"
import { ROUTE_PREVIEW_TOOLS } from "./omnis-ask"
import { toolPolicy } from "./tools/registry"

const NOW = new Date("2026-11-18T03:00:00Z")
const P: CrmProductRow[] = [
  { id: "p-2ml", code: "PRD101", name: "시험젤 (TESTGEL)", spec: "2ml", stock: 10, unit: "PIECE", volumeMl: 2, concentrationPct: 1 },
  { id: "p-5ml", code: "PRD102", name: "시험젤 (TESTGEL)", spec: "5ml", stock: 2, unit: "PIECE" },
  { id: "p-raw", code: "PRD103", name: "시험원료", spec: null, stock: 0.05, unit: "GRAM", isMaterial: true },
]
const O: CrmOrgRow[] = [
  { id: "o-1", code: "ORG101", name: "가나대학교", type: "UNIVERSITY", address: null, note: null, billingOrgId: null },
  { id: "o-2", code: "ORG102", name: "가나대학교 산학협력단", type: "UNIVERSITY", address: null, note: null, billingOrgId: null },
  { id: "o-3", code: "ORG103", name: "다라연구소", type: "RESEARCH", address: "서울", note: null, billingOrgId: null },
]
const S: CrmSampleView[] = [
  { id: "s-1", code: "HADD261117-001", date: "2026-11-17", org: { id: "o-3", name: "다라연구소" }, productId: "p-2ml", request: "시험젤 2ml 3개 샘플 전달", referral: null, note: null, sent: true, shipments: [{ id: "sh-1", code: "SH101", quantity: 3, productId: "p-2ml" }] },
  { id: "s-2", code: "HADD261117-002", date: "2026-11-17", org: { id: "o-3", name: "다라연구소" }, productId: null, request: "자료 요청", referral: null, note: null, sent: false, shipments: [] },
]
const port: CrmPort = {
  products: async () => P,
  orgs: async () => O,
  sample: async (ref) => S.find((s) => s.id === ref || s.code === ref) ?? null,
}
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

test("record_production — 완제품은 늘고 원료는 준다, 그램 계산 · 원료 모자람 경고", async () => {
  const p = await plan("record_production", { product_id: "p-2ml", material_id: "p-raw", quantity: 5, note: "로트 A" })
  assert.equal(p.problem, undefined)
  assert.equal(row(p, "재고 · 시험젤 (TESTGEL) 2ml")?.after, "15개")
  const op = p.op?.kind === "production" ? p.op.input : null
  assert.ok(op && op.materialGrams! > 0)
  assert.match(p.warning ?? "", /모자랍니다/)
  assert.match((await plan("record_production", { product_id: "p-5ml", material_id: "p-raw", quantity: 1 })).problem ?? "", /용량/)
  assert.match((await plan("record_production", { product_id: "p-2ml", material_id: "p-5ml", quantity: 1 })).problem ?? "", /원료가 아닙니다/)
  assert.equal((await plan("record_production", { product_id: "p-5ml", material_id: "p-raw", quantity: 1, material_grams: 0.01 })).problem, undefined)
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

test("레지스트리 — CRM 쓰기는 MCP confirm · 앱 AI 확인 카드(confirm 칸 없음) · 질문 경로 미리보기", async () => {
  const specs = await agentToolSpecs()
  for (const name of ["update_sample", "delete_sample", "create_org", "update_org", "record_stock", "record_production"]) {
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
  assert.equal(toolPolicy("list_samples")!.agent, "read")
  assert.equal(toolPolicy("list_samples")!.ask, "read")
})
