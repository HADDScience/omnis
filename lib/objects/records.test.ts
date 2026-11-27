/**
 * P3 근거 · 이력 · 제안 표 — 마이그레이션 SQL(멱등 · CHECK 목록 · 기존 표 무변경), 되돌리기, 스키마 관계, 공개 범위 토큰.
 * 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@/generated/prisma/client"
import {
  AUTHOR_KINDS,
  EVIDENCE_SOURCE_KINDS,
  PROPOSAL_OPS,
  PROPOSAL_STATUSES,
  QUOTE_MAX,
  REVISION_OPS,
  canSeeTokens,
  isVisibilityToken,
  mergeVisibility,
} from "./records"

const NAME = "20261127230000_object_evidence"
const MIGRATION = readFileSync(join(process.cwd(), `prisma/migrations/${NAME}/migration.sql`), "utf8")
const ROLLBACK = readFileSync(join(process.cwd(), `prisma/rollbacks/${NAME}.down.sql`), "utf8")
const P2_ROLLBACK = readFileSync(join(process.cwd(), "prisma/rollbacks/20261127200000_object_definitions.down.sql"), "utf8")
const TABLES = ["Proposal", "Evidence", "ObjectRevision"]
/** 외래키가 가리켜도 되는 표 — 새 표끼리와 P2 정의 표 */
const FK_TARGETS = [...TABLES, "ObjectType"]

const sql = MIGRATION.replace(/--.*$/gm, "")

test("마이그레이션은 다시 돌려도 된다 — IF NOT EXISTS · 제약은 지우고 다시 건다", () => {
  for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/g)) assert.fail(`IF NOT EXISTS 없는 CREATE: ${m[0]}`)
  const adds = [...sql.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)"/g)]
  assert.ok(adds.length >= 15)
  for (const [, table, name] of adds)
    assert.ok(sql.includes(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`), `${name}: 앞에 DROP CONSTRAINT IF EXISTS 가 없다`)
})

test("CREATE TABLE 마다 기본키가 있고 괄호가 닫힌다 — 잘린 문장이 없다", () => {
  // 처음 만든 파일은 빈 줄로 문장을 나누다 CONSTRAINT … PRIMARY KEY 와 「);」 가 빠져 문법 오류였다(2026-11-27 로컬 deploy 에서 걸림)
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)" \(([\s\S]*?)\n\);/g)]
  assert.deepEqual(tables.map((t) => t[1]), TABLES)
  for (const [, name, body] of tables) {
    assert.match(body, new RegExp(`CONSTRAINT "${name}_pkey" PRIMARY KEY \\("id"\\)`), name)
    assert.doesNotMatch(body, /CREATE /, `${name}: 다음 문장이 표 안으로 들어왔다`)
  }
  const opens = (sql.match(/\(/g) ?? []).length
  const closes = (sql.match(/\)/g) ?? []).length
  assert.equal(opens, closes, "괄호 짝")
})

test("마이그레이션은 기존 표를 건드리지 않는다 — 새 표 셋에만 쓰고, 외래키는 새 표 · ObjectType 으로만", () => {
  for (const [, table] of sql.matchAll(/(?:ALTER TABLE|CREATE TABLE IF NOT EXISTS|ON) "(\w+)"/g)) assert.ok(TABLES.includes(table), table)
  for (const [, target] of sql.matchAll(/REFERENCES "(\w+)"/g)) assert.ok(FK_TARGETS.includes(target), `외래키 대상 ${target}`)
  const statements = sql.replace(/ON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL)/g, "").replace(/'[^']*'/g, "''")
  assert.doesNotMatch(statements, /\bDROP\s+TABLE\b|\bDROP\s+TYPE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i)
})

test("CHECK 값 목록이 lib/objects/records.ts 와 같다", () => {
  const inList = (c: string) => {
    const m = new RegExp(`"${c}" CHECK \\(([\\s\\S]*?)\\);`).exec(MIGRATION)
    assert.ok(m, c)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  assert.deepEqual(inList("Proposal_op_check"), [...PROPOSAL_OPS])
  assert.deepEqual(inList("Proposal_status_check"), [...PROPOSAL_STATUSES])
  assert.deepEqual(inList("Evidence_sourceKind_check"), [...EVIDENCE_SOURCE_KINDS])
  assert.deepEqual(inList("ObjectRevision_op_check"), [...REVISION_OPS])
  assert.deepEqual(inList("ObjectRevision_authorKind_check"), [...AUTHOR_KINDS])
  assert.match(MIGRATION, new RegExp(`char_length\\("quote"\\) <= ${QUOTE_MAX}\\)`))
})

test("되돌리기 — 표 셋과 기록 줄을 지우고, P2 되돌리기는 이것이 먼저라고 적혀 있다", () => {
  for (const t of TABLES) assert.match(ROLLBACK, new RegExp(`DROP TABLE IF EXISTS "${t}";`), t)
  assert.match(ROLLBACK, new RegExp(`DELETE FROM "_prisma_migrations" WHERE "migration_name" = '${NAME}';`))
  assert.doesNotMatch(ROLLBACK.replace(/--.*$/gm, ""), /DROP TABLE IF EXISTS "Object(Type|Field)"/)
  assert.match(P2_ROLLBACK, new RegExp(NAME))
})

test("스키마 — 새 모델 셋의 관계는 새 표 · ObjectType 으로만 간다", () => {
  const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]))
  for (const t of TABLES) {
    const m = models.get(t)
    assert.ok(m, t)
    for (const f of m.fields.filter((x) => x.kind === "object")) assert.ok(FK_TARGETS.includes(f.type), `${t}.${f.name} → ${f.type}`)
  }
  // 기존 모델에서 새 표로 가는 관계는 ObjectType(P2) 에만 더했다
  for (const m of models.values())
    if (!FK_TARGETS.includes(m.name))
      for (const f of m.fields) assert.ok(!(f.kind === "object" && TABLES.includes(f.type)), `${m.name}.${f.name} 가 ${f.type} 를 가리킨다`)
})

test("공개 범위 토큰 — 여섯 가지만", () => {
  for (const ok of ["internal", "group:ip", "group:hr", "group:admin", "room:abc-123", "room:" + "x".repeat(64)]) assert.ok(isVisibilityToken(ok), ok)
  for (const bad of ["", "public", "Internal", "group:sales", "group:", "room:", "room:a b", "room:" + "x".repeat(65), "user:1"]) assert.ok(!isVisibilityToken(bad), bad)
})

test("공개 범위 합치기 · 보기", () => {
  assert.deepEqual(mergeVisibility(["room:b"], ["internal", "room:a"], ["room:b"]), ["internal", "room:a", "room:b"])
  assert.deepEqual(mergeVisibility(), [])
  assert.throws(() => mergeVisibility(["public"]), /모르는 공개 범위 토큰/)
  const viewer = new Set(["internal", "room:a"])
  assert.ok(canSeeTokens([], viewer))
  assert.ok(canSeeTokens(["room:a"], viewer))
  assert.ok(!canSeeTokens(["room:a", "room:b"], viewer), "두 방 근거는 두 방에 모두 든 사람만")
  assert.ok(!canSeeTokens(["group:ip"], viewer))
})
