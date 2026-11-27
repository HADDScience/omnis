// scripts/guard-custom-screens.mjs — 맞춤 화면 경로 diff 0 검사(공통 층 1단계). 걸려야 하는 것 · 지나가야 하는 것
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { LIST_PATH, findViolations, matches, parsePatterns, reasonIn } from "../scripts/guard-custom-screens.mjs"

const PATTERNS: string[] = parsePatterns(readFileSync(LIST_PATH, "utf8"))

test("목록 — 설명 · 빈 줄을 버리고, 경로마다 실제로 있다", () => {
  assert.ok(PATTERNS.length >= 15)
  for (const p of PATTERNS) {
    assert.ok(!p.startsWith("#") && !p.includes(" "), p)
    assert.ok(existsSync(p.endsWith("/**") ? p.slice(0, -3) : p), `없는 경로: ${p}`)
  }
})

test("화면마다 걸린다", () => {
  const hit = [
    "app/(main)/ip/record/page.tsx",
    "app/api/ip-mcp/[[...path]]/route.ts",
    "components/ip/stage-slider.tsx",
    "app/(main)/omnis/grants/page.tsx",
    "app/api/grants/decisions/route.ts",
    "components/grants/decision-list.tsx",
    "app/(main)/crm/orgs/page.tsx",
    "app/api/crm/orgs/route.ts",
    "components/crm/quote-composer.tsx",
    "app/(main)/omnis/records/page.tsx",
    "app/(main)/omnis/company/page.tsx",
    "app/api/company/record-proposals/route.ts",
    "components/company/record-proposal-list.tsx",
    "app/(main)/omnis/proposals/page.tsx",
    "components/omnis/proposal-list.tsx",
  ]
  assert.deepEqual(findViolations(PATTERNS, hit), hit)
})

test("맞춤 화면이 아닌 곳은 지나간다 — 이름이 비슷한 경로 포함", () => {
  const pass = [
    "lib/objects/sync.ts",
    "prisma/schema.prisma",
    "scripts/guard-custom-screens.txt",
    "app/(main)/omnis/ask/page.tsx",
    "app/(main)/ipx/page.tsx", // ip 로 시작하지만 다른 폴더
    "app/api/ipsum/route.ts",
    "components/omnis/proposal-list.test.tsx", // 파일 하나 규칙은 그 파일만
    "components/crmx/a.tsx",
    "app/(main)/omnis/grants-old.tsx",
  ]
  assert.deepEqual(findViolations(PATTERNS, pass), [])
})

test("규칙 — /** 는 폴더 아래, 그 밖은 파일 하나", () => {
  assert.ok(matches("components/ip/**", "components/ip/a/b.tsx"))
  assert.ok(!matches("components/ip/**", "components/ip"))
  assert.ok(matches("components/omnis/proposal-list.tsx", "components/omnis/proposal-list.tsx"))
  assert.ok(!matches("components/omnis/proposal-list.tsx", "components/omnis/proposal-list.tsx.bak"))
})

test("PR 본문의 까닭 — 한 줄이 있어야 하고 비울 수 없다", () => {
  assert.equal(reasonIn("요약\n\n맞춤 화면 변경: P7 — 제안 화면을 통합 목록으로 바꾼다\n"), "P7 — 제안 화면을 통합 목록으로 바꾼다")
  assert.equal(reasonIn("맞춤 화면 변경 : 오탈자"), "오탈자")
  assert.equal(reasonIn("맞춤 화면 변경:"), null)
  assert.equal(reasonIn("맞춤 화면 변경:   "), null)
  assert.equal(reasonIn("맞춤 화면 변경:\n다음 줄은 까닭이 아니다"), null)
  assert.equal(reasonIn("맞춤 화면을 바꾸지 않았다"), null)
  assert.equal(reasonIn(undefined), null)
})
