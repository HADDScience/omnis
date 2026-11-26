/** 국가과제 상태 v2(2026-11-26) — 순서 · 상태별 칸 · 확정 지원금. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import {
  GRANT_STAGES,
  GRANT_STAGE_LABEL,
  GRANT_START_STAGE,
  asStage,
  isGrantStage,
  stageFieldShown,
  stageLabel,
  won,
} from "./grants-labels"
import { parseWon } from "./grants"
import { staleFields } from "./grants-expect"
import { GRANT_TOOLS } from "./tools/defs-grants"

test("상태 7개 — 순서 · 이름표, 검토 · 불참은 없다", () => {
  assert.deepEqual(GRANT_STAGES, [
    "PREPARING",
    "SUBMITTED",
    "SELECTED",
    "REJECTED",
    "IN_PROGRESS",
    "COMPLETED",
    "STOPPED",
  ])
  assert.deepEqual(Object.values(GRANT_STAGE_LABEL), [
    "준비",
    "제출 완료",
    "선정됨",
    "미선정",
    "수행 중",
    "완료",
    "중단",
  ])
  assert.equal(GRANT_START_STAGE, "PREPARING")
  assert.equal(isGrantStage("REVIEW"), false)
  assert.equal(isGrantStage("DROPPED"), false)
  assert.equal(stageLabel("REVIEW"), "REVIEW")
  assert.equal(asStage("SELECTED"), "SELECTED")
})

test("마이그레이션 CHECK 와 도구 enum 이 이름표와 같은 값이다", () => {
  const sql = readFileSync(
    new URL("../prisma/migrations/20261126190000_grant_stages_v2/migration.sql", import.meta.url),
    "utf8"
  )
  const check = /CHECK \("stage" IN \(([^)]*)\)\)/.exec(sql)![1]
  assert.deepEqual(
    check.split(",").map((v) => v.trim().replace(/'/g, "")),
    GRANT_STAGES
  )
  for (const t of GRANT_TOOLS) {
    const stage = (t.inputSchema.properties as Record<string, { enum?: readonly string[] }>).stage
    if (stage) assert.deepEqual([...stage.enum!], GRANT_STAGES, t.name)
  }
})

test("상태별 칸 — 그 상태 이후에만 보이고, 값이 있으면 어느 상태든 보인다", () => {
  assert.equal(stageFieldShown("selectedOn", "PREPARING", false), false)
  assert.equal(stageFieldShown("selectedOn", "SELECTED", false), true)
  assert.equal(stageFieldShown("awardedAmount", "IN_PROGRESS", false), true)
  assert.equal(stageFieldShown("agreementOn", "SELECTED", false), false)
  assert.equal(stageFieldShown("endsOn", "IN_PROGRESS", false), true)
  assert.equal(stageFieldShown("completedOn", "IN_PROGRESS", false), false)
  assert.equal(stageFieldShown("completedOn", "COMPLETED", false), true)
  // 수행 중에 그만두면(중단) 적어 둔 수행 기간은 그대로 보인다
  assert.equal(stageFieldShown("startsOn", "STOPPED", true), true)
  assert.equal(stageFieldShown("startsOn", "STOPPED", false), false)
})

test("확정 지원금 — 원 단위 정수, 쉼표 · 「원」 허용, 빈 값은 지움", () => {
  assert.equal(parseWon("120000000"), BigInt(120000000))
  assert.equal(parseWon("1,500,000,000원"), BigInt(1500000000))
  assert.equal(parseWon(30), BigInt(30))
  assert.equal(parseWon(""), null)
  assert.equal(parseWon(null), null)
  assert.equal(parseWon("1.5억"), undefined)
  assert.equal(parseWon(-1), undefined)
  assert.equal(won(BigInt(120000000)), "120,000,000원")
  // 21억 넘는 금액도 담는다(BIGINT)
  assert.equal(parseWon("3000000000"), BigInt(3000000000))
})

test("충돌 확인 — 확정 지원금은 숫자로 맞춰 본다", () => {
  const kinds = { awardedAmount: "int" } as const
  assert.deepEqual(staleFields({ awardedAmount: "120000000" }, { awardedAmount: BigInt(120000000) }, kinds), [])
  assert.deepEqual(staleFields({ awardedAmount: "" }, { awardedAmount: null }, kinds), [])
  assert.deepEqual(staleFields({ awardedAmount: "1" }, { awardedAmount: BigInt(2) }, kinds), ["awardedAmount"])
})
