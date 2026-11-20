/**
 * 라우트 ↔ 도구 표(#248) — app/api 의 사용자용 라우트 메서드마다 도구가 있거나, 시스템이거나(이유), 나중(이유)이어야 한다.
 * 새 라우트를 만들고 lib/tools/route-coverage.ts 에 적지 않으면 실패한다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { ROUTE_COVERAGE, type Coverage } from "./route-coverage"
import { TOOL_POLICY } from "./registry"

const API = join(process.cwd(), "app/api")
/** readonly 배열은 Array.isArray 로 좁혀지지 않는다 */
const isTools = (c: Coverage): c is Extract<Coverage, readonly string[]> => Array.isArray(c)
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const EXPORT = /^export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b|^export const (GET|POST|PUT|PATCH|DELETE)\b/gm

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? routeFiles(p) : name === "route.ts" ? [p] : []
  })
}

/** 지금 코드에 있는 「라우트 메서드」 */
function routeKeys(): string[] {
  return routeFiles(API).flatMap((f) => {
    const route = relative(API, f).replace(/\/route\.ts$/, "")
    const found = new Set<string>()
    for (const m of readFileSync(f, "utf8").matchAll(EXPORT)) found.add(m[1] ?? m[2])
    return METHODS.filter((m) => found.has(m)).map((m) => `${route} ${m}`)
  })
}

test("모든 라우트 메서드가 표에 있다 — 새 라우트는 도구를 만들거나 이유를 적는다", () => {
  const missing = routeKeys().filter((k) => !(k in ROUTE_COVERAGE))
  assert.deepEqual(missing, [], `lib/tools/route-coverage.ts 에 없는 라우트 메서드: ${missing.join(", ")}`)
})

test("표에만 있고 코드에 없는 줄이 없다", () => {
  const keys = new Set(routeKeys())
  const stale = Object.keys(ROUTE_COVERAGE).filter((k) => !keys.has(k))
  assert.deepEqual(stale, [], `지운 라우트를 표에서도 빼세요: ${stale.join(", ")}`)
})

test("도구 줄은 있는 도구만, 시스템 · 나중 줄은 이유가 있다", () => {
  for (const [key, c] of Object.entries(ROUTE_COVERAGE)) {
    if (isTools(c)) {
      assert.ok(c.length > 0, `${key}: 도구가 비었다`)
      for (const t of c) assert.ok(t in TOOL_POLICY, `${key}: 없는 도구 ${t}`)
    } else if ("system" in c) {
      assert.ok(c.system.trim().length >= 10, `${key}: 시스템 이유가 너무 짧다`)
    } else {
      assert.ok(c.later.trim().length >= 10, `${key}: 나중 이유가 너무 짧다`)
    }
  }
})

test("「나중」 은 늘지 않는다 — 도구로 메우면 줄인다", () => {
  const later = Object.entries(ROUTE_COVERAGE).filter(([, c]) => !isTools(c) && "later" in c).map(([k]) => k)
  // 2026-11-18(#248): 채팅 글 고치기 · 지우기(#242 머지 뒤), 지식재산권 대장 전체 칸, 지식재산권 구성원 2
  assert.ok(later.length <= 5, `「나중」 이 늘었다(${later.length}): ${later.join(", ")}`)
})
