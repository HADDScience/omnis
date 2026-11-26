/** Gemini 도구 스키마 줄이기 — 모르는 칸 하나가 질문 경로 전체를 400 으로 막는다. 실행: pnpm test:unit */
import { test } from "node:test"
import assert from "node:assert/strict"
import { geminiSchema } from "./ai"
import { TOOLS } from "./omnis-mcp"

const ALLOWED = new Set([
  "type",
  "format",
  "title",
  "description",
  "nullable",
  "enum",
  "properties",
  "required",
  "items",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "anyOf",
  "default",
  "example",
  "propertyOrdering",
])

function problems(tool: string, path: string, node: unknown, out: string[]) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return
  const o = node as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (!ALLOWED.has(k)) out.push(`${tool}${path}.${k}`)
    if (
      k === "enum" &&
      Array.isArray(v) &&
      v.some((x) => typeof x !== "string")
    )
      out.push(`${tool}${path}.enum`)
    if (k === "properties" && v && typeof v === "object")
      for (const [n, sub] of Object.entries(v as Record<string, unknown>))
        problems(tool, `${path}.${n}`, sub, out)
    if (k === "items") problems(tool, `${path}[]`, v, out)
  }
}

test("모르는 칸은 빼고 숫자 enum 은 설명으로 옮긴다 — 속성 이름은 건드리지 않는다", () => {
  const s = geminiSchema({
    type: "object",
    $schema: "x",
    additionalProperties: false,
    properties: {
      days: { type: "integer", description: "기간", enum: [7, 30] },
      additionalProperties: { type: "string" },
      users: { type: "object", additionalProperties: { type: "integer" } },
    },
  }) as { properties: Record<string, unknown> }
  assert.deepEqual(Object.keys(s), ["type", "properties"])
  assert.deepEqual(s.properties.days, {
    type: "integer",
    description: "기간 (7 · 30 중 하나)",
  })
  assert.deepEqual(s.properties.additionalProperties, { type: "string" })
  assert.deepEqual(s.properties.users, { type: "object" })
})

test("모든 도구 스키마가 줄인 뒤 Gemini 가 받는 모양이다", () => {
  const out: string[] = []
  for (const t of TOOLS)
    problems(
      t.name,
      "",
      geminiSchema((t as { inputSchema?: unknown }).inputSchema),
      out
    )
  assert.deepEqual(out, [])
})
