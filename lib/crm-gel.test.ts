/**
 * CRM 젤 타입 재고 규칙 — 합산 · 원재료 차감 · 되돌림 · 범위 검사. DB 없이 돈다. 실행: pnpm test:unit
 * 11/25 2차: 개수는 세지 않는다(ml 만). 원재료 차감 = 농도/100 × ml(농도는 g/100ml).
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import * as gel from "./crm-gel"
import {
  amountText, CONC_MAX, CONC_MIN, gelLots, gelMaterialGrams, gelShortWarning, lotMl, lotText,
  materialShortWarning, parseConc, parseMl, resolveMaterial, rowProductLabel, variantLabel, type GelMove,
} from "./crm-gel"

const IN = (conc: number, ml: number): GelMove => ({ direction: "IN", quantity: ml, concentrationPct: conc })
const OUT = (conc: number, ml: number): GelMove => ({ direction: "OUT", quantity: ml, concentrationPct: conc })

test("합산 — 같은 (타입, 농도)는 ml 로 더한다. 개수 칸은 없다", () => {
  const lots = gelLots([IN(1, 15), IN(1, 10), IN(10, 5)])
  assert.equal(lots.length, 2)
  assert.equal(lotMl(lots, 1), 25)
  assert.deepEqual(Object.keys(lots[0]).sort(), ["conc", "inMl", "ml", "outMl"])
  assert.equal(lotText(lots[0]), "25ml")
  assert.equal(lotMl(lots, 10), 5)
  assert.equal(lotMl(lots, 2), 0)
  assert.equal(lotText(null), "0ml")
})

test("합산 — 출고는 그 칸에서 빠진다(소수 ml 도)", () => {
  const lots = gelLots([IN(1, 15), OUT(1, 5), OUT(1, 2.5)])
  assert.equal(lotMl(lots, 1), 7.5)
  assert.equal(lots[0].inMl, 15)
  assert.equal(lots[0].outMl, 7.5)
})

test("합산 — 농도가 빈 줄은 숨기지 않고 0 칸에 모은다", () => {
  const lots = gelLots([{ direction: "IN", quantity: 4, concentrationPct: null }])
  assert.equal(lots[0].conc, 0)
  assert.equal(lots[0].ml, 4)
})

test("원재료 차감 — 농도 % 를 g/100ml 로 보고 농도/100 × ml. 밀도 상수는 없다", () => {
  assert.equal("GEL_GRAMS_PER_ML" in gel, false)
  assert.equal(gelMaterialGrams(1, 25), 0.25)
  assert.equal(gelMaterialGrams(10, 5), 0.5)
  assert.equal(gelMaterialGrams(10, 25), 2.5)
  assert.equal(gelMaterialGrams(0.74, 3), 0.022)
  assert.equal(gelMaterialGrams(20, 0.5), 0.1)
  assert.match(materialShortWarning("DNA", 0.1, 0.25) ?? "", /모자랍니다 .* -0\.15g/)
  assert.equal(materialShortWarning("DNA", 1, 0.25), null)
})

test("되돌림 — 생산 IN 줄을 거두면 생산 전 재고와 같다", () => {
  const before = [IN(1, 108)]
  const production = [IN(1, 25)]
  assert.equal(lotMl(gelLots([...before, ...production]), 1), 133)
  const undone = gelLots([...before, ...production, ...production.map((m) => ({ ...m, direction: "OUT" as const }))])
  assert.equal(lotMl(undone, 1), lotMl(gelLots(before), 1))
})

test("범위 검사 — 농도 0.5~20 %, ml 양수", () => {
  assert.equal(CONC_MIN, 0.5)
  assert.equal(CONC_MAX, 20)
  assert.deepEqual(parseConc(0.5), { conc: 0.5 })
  assert.deepEqual(parseConc("10%"), { conc: 10 })
  assert.deepEqual(parseConc("2 wt%"), { conc: 2 }) // 옛 표기로 적어도 읽는다
  assert.ok("problem" in parseConc(0.4))
  assert.ok("problem" in parseConc(20.1))
  assert.ok("problem" in parseConc(""))
  assert.ok("problem" in parseConc(null))
  const p = parseConc("")
  assert.ok("problem" in p && !p.problem.includes("wt"))
  assert.deepEqual(parseMl("5ml"), { ml: 5 })
  assert.deepEqual(parseMl(0.25), { ml: 0.25 })
  assert.deepEqual(parseMl(25), { ml: 25 })
  assert.ok("problem" in parseMl(0))
  assert.ok("problem" in parseMl(-2))
})

test("개수 규칙은 없어졌다 — 용량 줄 · 개수 함수가 남아 있지 않다", () => {
  for (const name of ["parseLines", "linesTotalMl", "linesUnits", "breakdownText"]) assert.equal(name in gel, false, name)
})

test("경고 — 젤 재고가 모자라면 막지 않고 알린다", () => {
  assert.match(gelShortWarning("애드젤 · 10%", 5, 10) ?? "", /모자랍니다 .* -5ml/)
  assert.match(gelShortWarning("애드젤 · 10%", 5, 5) ?? "", /0ml 이 됩니다/)
  assert.equal(gelShortWarning("애드젤 · 10%", 5, 1), null)
})

test("원재료 매핑 — 설정이 우선, 없으면 원료가 하나일 때만 그것(두 타입 모두 DNA)", () => {
  const mats = [{ id: "m1", code: "PRD005", name: "DNA" }]
  assert.equal(resolveMaterial("ADDGEL", null, mats)?.id, "m1")
  assert.equal(resolveMaterial("LIVEGEL", null, mats)?.id, "m1")
  assert.equal(resolveMaterial("ADDGEL", null, [...mats, { id: "m2", code: "PRD099", name: "다른 원료" }]), null)
  assert.equal(resolveMaterial("LIVEGEL", { LIVEGEL: null }, mats), null)
  assert.equal(resolveMaterial("LIVEGEL", { LIVEGEL: "PRD099" }, [...mats, { id: "m2", code: "PRD099", name: "다른 원료" }])?.id, "m2")
  assert.equal(resolveMaterial("ADDGEL", { LIVEGEL: null }, mats)?.id, "m1") // 설정에 없는 타입은 기본 규칙
})

test("이름 · 양 — 젤은 농도 · ml, 아니면 이름 규격 · 개수", () => {
  assert.equal(variantLabel("애드젤 (ADD GEL)", 10, 25), "애드젤 (ADD GEL) · 10% · 25ml")
  assert.equal(rowProductLabel({ name: "애드젤 (ADD GEL)", gelType: "ADDGEL" }, { concentrationPct: "1.000", volumeMl: "15.000" }), "애드젤 (ADD GEL) · 1% · 15ml")
  assert.equal(rowProductLabel({ name: "고정제", spec: null }), "고정제")
  assert.equal(rowProductLabel({ name: "애드젤 (ADD Gel)", spec: "동결건조" }), "애드젤 (ADD Gel) 동결건조")
  assert.equal(amountText({ quantity: null, volumeMl: "15.000" }, "ADDGEL"), "15ml")
  assert.equal(amountText({ quantity: 3, volumeMl: null }, null), "3개")
})
