/**
 * 제품을 ID 로 고르기 — list_products 로 목록을 보고 record_sample 에 product_id 를 넣는 흐름.
 * 모델은 스텁이다: 목록 줄을 읽어 사용자 말에 맞는 줄의 product_id 를 고른다(실제 모델이 할 일을 흉내).
 * 제품 이름은 지어낸 것이다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  normalizeUnits, parseSampleArgs, pickProduct, productListLine, resolveProduct, stockWarning,
  type ProductRow,
} from "./crm-sample-rules"

const P: ProductRow[] = [
  { id: "p-2ml", code: "PRD101", name: "시험젤 (TESTGEL)", spec: "2ml", stock: 12, unit: "PIECE" },
  { id: "p-5ml", code: "PRD102", name: "시험젤 (TESTGEL)", spec: "5ml", stock: 3, unit: "PIECE" },
  { id: "p-live3", code: "PRD103", name: "다른젤 (Other Gel)", spec: "3ml", stock: 0, unit: "PIECE" },
  { id: "p-raw", code: "PRD104", name: "원료", spec: null, stock: 4.5, unit: "GRAM" },
]

/** 도구 스텁 — 앱 AI · MCP 가 같은 runTool 로 부르는 두 도구를 순수 함수로 */
const tools = {
  list_products: () => P.map(productListLine).join("\n"),
  record_sample: (args: Record<string, unknown>) => {
    const parsed = parseSampleArgs(args, new Date("2026-11-17T03:00:00Z"))
    if (!parsed.ok) return { problem: parsed.error }
    return resolveProduct(parsed.value, P)
  },
}

/**
 * 모델 스텁 — ① list_products 를 부르고 ② 줄마다 이름 · 별칭 · 규격을 사용자 말과 맞춰 하나면 product_id 로 record_sample,
 * 여럿이면 부르지 않고 후보를 들고 사용자에게 묻는다.
 */
function stubAgent(said: string): { calls: string[]; asked?: string[]; result?: ReturnType<typeof tools.record_sample> } {
  const calls = ["list_products"]
  const lines = tools.list_products().split("\n")
  const rows = lines.map((l) => {
    const id = /product_id=([^ ]+)/.exec(l)![1]
    const [, , name, ...rest] = l.split(" · ")
    const spec = rest.find((r) => r.startsWith("규격 "))!.slice(3)
    return { id, code: "", name, spec: spec === "-" ? null : spec }
  })
  const picked = pickProduct(said, rows)
  if (picked.kind !== "one") return { calls, asked: picked.kind === "many" ? picked.candidates.map((c) => c.id) : [] }
  calls.push("record_sample")
  return { calls, result: tools.record_sample({ org: "시험기관", product_id: picked.product.id, quantity: 2 }) }
}

test("목록 줄에 product_id · 코드 · 이름 · 별칭 · 규격 · 재고가 있다", () => {
  assert.equal(productListLine(P[0]), "- product_id=p-2ml · PRD101 · 시험젤 (TESTGEL) · 별칭 TESTGEL · 규격 2ml · 재고 12개")
  assert.equal(productListLine(P[3]), "- product_id=p-raw · PRD104 · 원료 · 규격 - · 재고 4.5g")
})

test("「시험젤 2미리」 · 「TESTGEL 2ml」 · 「testgel 2 mL」 — 목록에서 2ml 를 골라 product_id 로 부른다", () => {
  for (const said of ["시험젤 2미리", "TESTGEL 2ml", "testgel 2 mL", "시험젤 (TESTGEL) 2밀리"]) {
    const r = stubAgent(said)
    assert.deepEqual(r.calls, ["list_products", "record_sample"], said)
    assert.ok(r.result && "product" in r.result && r.result.product?.id === "p-2ml", said)
  }
})

test("규격이 여럿이면 부르지 않고 후보를 들고 묻는다", () => {
  const r = stubAgent("시험젤")
  assert.deepEqual(r.calls, ["list_products"])
  assert.deepEqual(r.asked?.sort(), ["p-2ml", "p-5ml"])
})

test("product_id 가 있으면 이름은 보지 않는다 · 코드로도 된다 · 없는 id 는 목록을 다시 보라고", () => {
  assert.equal((resolveProduct({ productId: "p-5ml", product: "다른젤 3ml" }, P) as { product: ProductRow }).product.id, "p-5ml")
  assert.equal((resolveProduct({ productId: "prd103", product: null }, P) as { product: ProductRow }).product.id, "p-live3")
  const miss = resolveProduct({ productId: "nope", product: "시험젤 2ml" }, P)
  assert.ok("problem" in miss && miss.problem.includes("list_products"))
})

test("이름만 있으면 예전처럼 맞춰 보고, 여럿이면 후보에 product_id 를 붙여 돌려준다", () => {
  assert.equal((resolveProduct({ productId: null, product: "다른젤 3ml" }, P) as { product: ProductRow }).product.id, "p-live3")
  const many = resolveProduct({ productId: null, product: "시험젤" }, P)
  assert.ok("problem" in many && many.problem.includes("product_id=p-2ml") && many.problem.includes("product_id=p-5ml"))
  assert.deepEqual(resolveProduct({ productId: null, product: null }, P), { product: null })
})

test("수량은 product_id 만 있어도 된다 · 기존 입력(product)도 그대로", () => {
  assert.equal(parseSampleArgs({ org: "x", product_id: "p-2ml", quantity: 2 }).ok, true)
  assert.equal(parseSampleArgs({ org: "x", product: "시험젤 2ml", quantity: 2 }).ok, true)
  assert.equal(parseSampleArgs({ org: "x", quantity: 2 }).ok, false)
})

test("단위 말 — 미리 · 밀리 · ㎖ · mL → ml", () => {
  assert.equal(normalizeUnits("시험젤 2미리"), "시험젤 2ml")
  assert.equal(normalizeUnits("2 밀리리터"), "2ml")
  assert.equal(normalizeUnits("3㎖"), "3ml")
  assert.equal(normalizeUnits("2 mL"), "2ml")
})

test("재고 경고 — 0 이 되거나 모자라면", () => {
  assert.equal(stockWarning(12, 2), null)
  assert.match(stockWarning(3, 3)!, /0 이 됩니다/)
  assert.match(stockWarning(0, 2)!, /모자랍니다.*-2개/)
  assert.match(stockWarning(4.5, 5, "GRAM")!, /-0.5g/)
})
