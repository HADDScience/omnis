/** TIPS 가점 칸 읽기. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readTipsBonus, tipsRulesFrom, tipsShort } from "./grants-tips"

test("tips_bonus — 가점표에 있는 항목은 한 줄 요약, 「같음」 은 개인 판정을 따른다", () => {
  const t = readTipsBonus({
    tips_bonus: {
      general: { applies: true, points: "1점(벤처·이노비즈 중 최대 1점)" },
      deeptech: { applies: true, points: "최대 1점" },
      our_sole: "해당 — 1점",
      our_corp: "같음",
    },
  })
  assert.equal(tipsShort(t), "일반 1점 · 딥테크 최대 1점")
  assert.equal(t?.corp, "해당 — 1점")
})

test("tips_bonus — 가점표에 없거나 칸이 없으면 요약 없음", () => {
  assert.equal(readTipsBonus({}), null)
  const none = readTipsBonus({
    tips_bonus: {
      general: { applies: false, points: null },
      deeptech: { applies: false, points: null },
      our_sole: "188호 가점표에 없는 항목",
      our_corp: "같음",
    },
  })
  assert.equal(tipsShort(none), null)
  const deepOnlyRequirement = readTipsBonus({
    tips_bonus: {
      general: { applies: true, points: "1점" },
      deeptech: { applies: false, points: "가점 아님 — 필수 요건" },
    },
  })
  assert.equal(tipsShort(deepOnlyRequirement), "일반 1점")
})

test("tips_rules — 상한 · 접수 · 근거를 옮긴다", () => {
  const r = tipsRulesFrom({
    general_cap: "가점 합산 최대 5점",
    deeptech_cap: "가점 합산 최대 3점",
    window_2026: "분기 접수",
    basis: { title: "공고 제2026-188호", url: "https://example.org/a" },
  })
  assert.equal(r?.generalCap, "가점 합산 최대 5점")
  assert.equal(r?.basisUrl, "https://example.org/a")
  assert.equal(r?.deeptechNote, null)
})
