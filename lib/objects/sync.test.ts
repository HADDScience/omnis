/**
 * objects:sync 계획(lib/objects/sync.ts) — 멱등 · 숨기기 · 버전 · 바뀌지 않는 칸, 그리고 P2 마이그레이션 SQL 대조.
 * DB 없이 돈다: 계획을 메모리의 「DB 모습」 에 적용해 두 번째 계획이 0 인지 본다.
 * 실제 DB 에서의 두 번 실행은 PR 본문 · 보고서에 출력을 붙였다. 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@/generated/prisma/client"
import { TOOL_POLICY } from "../tools/registry"
import {
  ACTION_KINDS,
  ACTION_RISKS,
  DATA_TYPES,
  FRAMES,
  KEY_PATTERN,
  STORAGES,
  VISIBILITY_POLICIES,
  type OptionSetDef,
  type TypeDef,
} from "./define"
import { OBJECT_TYPES } from "./index"
import { OPTION_SETS } from "./options"
import { compareDefinitions, planSync, type DbState, type SyncOp } from "./sync"

const NOW = new Date("2026-11-27T00:00:00Z")
const confirmOf = (tool: string) => (TOOL_POLICY as Record<string, { confirm?: string }>)[tool]?.confirm ?? null
const empty = (): DbState => ({ types: [], fields: [], options: [], actions: [], latestVersions: [] })

/** 계획을 메모리의 DB 모습에 적용한다(scripts/objects-sync.ts 의 apply 와 같은 뜻) */
function applyOps(db: DbState, ops: readonly SyncOp[]): DbState {
  const s: DbState = structuredClone(db)
  for (const op of ops) {
    if (op.table === "ObjectType") {
      if (op.op === "create") s.types.push({ ...op.data, hiddenAt: null })
      else Object.assign(s.types.find((t) => t.key === op.key)!, op.data)
    } else if (op.table === "ObjectTypeVersion") {
      s.latestVersions = s.latestVersions.filter((v) => v.typeKey !== op.data.typeKey)
      s.latestVersions.push({ typeKey: op.data.typeKey, version: op.data.version, defHash: op.data.defHash, definition: op.data.definition })
    } else if (op.table === "ObjectField") {
      if (op.op === "create") s.fields.push({ ...op.data, hiddenAt: null })
      else Object.assign(s.fields.find((f) => f.typeKey === op.typeKey && f.key === op.key)!, op.data)
    } else if (op.table === "OptionValue") {
      if (op.op === "create") s.options.push({ ...op.data, hiddenAt: null })
      else Object.assign(s.options.find((o) => o.setKey === op.setKey && o.key === op.key)!, op.data)
    } else {
      if (op.op === "create") s.actions.push({ ...op.data, hiddenAt: null })
      else Object.assign(s.actions.find((a) => a.typeKey === op.typeKey && a.key === op.key)!, op.data)
    }
  }
  return s
}

const plan = (db: DbState, types: readonly TypeDef[] = OBJECT_TYPES, optionSets: readonly OptionSetDef[] = OPTION_SETS) =>
  planSync({ types, optionSets, db, confirmOf, now: NOW })
const count = (ops: readonly SyncOp[]) => {
  const c: Record<string, number> = {}
  for (const o of ops) c[`${o.table} ${o.op}`] = (c[`${o.table} ${o.op}`] ?? 0) + 1
  return c
}
const synced = () => applyOps(empty(), plan(empty()).ops)
const withType = (key: string, f: (t: TypeDef) => TypeDef) => OBJECT_TYPES.map((t) => (t.key === key ? f(t) : t))

// ─── 멱등 ───

test("빈 표에 처음 넣고, 두 번째 계획은 0 이다", () => {
  const first = plan(empty())
  assert.deepEqual(first.errors, [])
  const fields = OBJECT_TYPES.reduce((n, t) => n + t.fields.length, 0)
  const actions = OBJECT_TYPES.reduce((n, t) => n + t.actions.length, 0)
  const options = OPTION_SETS.reduce((n, s) => n + s.options.length, 0)
  assert.deepEqual(count(first.ops), {
    "OptionValue create": options,
    "ObjectType create": 3,
    "ObjectTypeVersion create": 3,
    "ObjectField create": fields,
    "ActionType create": actions,
  })
  const second = plan(applyOps(empty(), first.ops))
  assert.deepEqual(second, { ops: [], errors: [] })
})

test("처음 넣은 유형은 v1 이고, Action 확인 방법은 레지스트리에서 옮긴다", () => {
  const db = synced()
  assert.deepEqual(db.types.map((t) => [t.key, t.version]).sort(), [["grant_decision", 1], ["org", 1], ["record", 1]])
  assert.equal(db.actions.find((a) => a.typeKey === "record" && a.key === "save")!.confirm, "card")
  assert.equal(db.actions.find((a) => a.typeKey === "org" && a.key === "create")!.confirm, "param")
  assert.ok(db.fields.every((f) => f.sinceVersion === 1))
})

// ─── 바뀐 정의 ───

test("이름표만 바뀌면 그 칸 · 유형 해시 · 버전만 바뀌고 깨지지 않는다", () => {
  const db = synced()
  const types = withType("org", (t) => ({ ...t, fields: t.fields.map((f) => (f.key === "address" ? { ...f, label: "소재지" } : f)) }))
  const p = plan(db, types)
  assert.deepEqual(count(p.ops), { "ObjectType update": 1, "ObjectTypeVersion create": 1, "ObjectField update": 1 })
  const v = p.ops.find((o) => o.table === "ObjectTypeVersion")!
  assert.equal(v.table === "ObjectTypeVersion" && v.data.version, 2)
  assert.equal(v.table === "ObjectTypeVersion" && v.data.breaking, false)
  assert.deepEqual(plan(applyOps(db, p.ops), types).ops, [])
})

test("칸이 빠지면 지우지 않고 숨기고, 깨지는 변경으로 남는다. 돌아오면 다시 보인다", () => {
  const db = synced()
  const without = withType("org", (t) => ({ ...t, fields: t.fields.filter((f) => f.key !== "address") }))
  const p = plan(db, without)
  const hide = p.ops.find((o) => o.table === "ObjectField")!
  assert.deepEqual(hide.op === "update" && hide.data, { hiddenAt: NOW })
  const v = p.ops.find((o) => o.table === "ObjectTypeVersion")!
  assert.ok(v.table === "ObjectTypeVersion" && v.data.breaking && /칸 숨김 address/.test(v.data.summary))
  const hidden = applyOps(db, p.ops)
  assert.equal(hidden.fields.filter((f) => f.typeKey === "org").length, 7, "행은 남는다")

  const back = plan(hidden)
  const unhide = back.ops.find((o) => o.table === "ObjectField")!
  assert.deepEqual(unhide.op === "update" && unhide.data, { hiddenAt: null })
  assert.deepEqual(plan(applyOps(hidden, back.ops)).ops, [])
})

test("새 칸은 그때 버전을 sinceVersion 으로 갖고, 필수로 바꾸면 깨지는 변경이다", () => {
  const db = synced()
  const added = withType("org", (t) => ({ ...t, fields: [...t.fields, { key: "homepage", label: "홈페이지", dataType: "url", column: "address" }] }))
  const p = plan(db, added)
  const c = p.ops.find((o) => o.table === "ObjectField" && o.op === "create")!
  assert.equal(c.op === "create" && c.table === "ObjectField" && c.data.sinceVersion, 2)

  const req = withType("org", (t) => ({ ...t, fields: t.fields.map((f) => (f.key === "address" ? { ...f, required: true } : f)) }))
  const v = plan(db, req).ops.find((o) => o.table === "ObjectTypeVersion")!
  assert.ok(v.table === "ObjectTypeVersion" && v.data.breaking && /필수로 address/.test(v.data.summary))
})

test("선택지가 빠지면 숨기고, 그 묶음을 쓰는 유형은 깨지는 변경이다", () => {
  const db = synced()
  const sets = OPTION_SETS.map((s) => (s.key === "org_type" ? { ...s, options: s.options.filter((o) => o.key !== "hospital") } : s))
  const p = plan(db, OBJECT_TYPES, sets)
  assert.ok(p.ops.some((o) => o.table === "OptionValue" && o.op === "update" && o.key === "hospital" && o.data.hiddenAt === NOW))
  const versions = p.ops.filter((o) => o.table === "ObjectTypeVersion")
  assert.deepEqual(versions.map((v) => v.table === "ObjectTypeVersion" && v.data.typeKey), ["org"])
  assert.ok(versions[0].table === "ObjectTypeVersion" && versions[0].data.breaking)
})

test("코드에서 빠진 유형은 숨긴다", () => {
  const db = synced()
  const p = plan(db, OBJECT_TYPES.filter((t) => t.key !== "org"))
  assert.deepEqual(p.ops, [{ table: "ObjectType", op: "update", key: "org", data: { hiddenAt: NOW } }])
})

// ─── 바뀌지 않는 칸 ───

test("바꿀 수 없는 칸이 바뀌면 오류만 돌려주고 아무것도 쓰지 않는다", () => {
  const db = synced()
  const cases: [string, readonly TypeDef[], readonly OptionSetDef[], RegExp][] = [
    ["칸 dataType", withType("org", (t) => ({ ...t, fields: t.fields.map((f) => (f.key === "address" ? { ...f, dataType: "longtext" as const } : f)) })), OPTION_SETS, /org\.address: dataType/],
    ["칸 optionSetKey", withType("org", (t) => ({ ...t, fields: t.fields.map((f) => (f.key === "type" ? { ...f, optionSetKey: "record_kind" } : f)) })), OPTION_SETS, /org\.type: optionSetKey/],
    ["칸 refTypeKey", withType("record", (t) => ({ ...t, fields: t.fields.map((f) => (f.key === "project" ? { ...f, refTypeKey: "task" } : f)) })), OPTION_SETS, /record\.project: refTypeKey/],
    ["유형 storage", withType("org", (t) => ({ ...t, storage: "ledger" as const })), OPTION_SETS, /org: storage/],
    ["유형 backing", withType("org", (t) => ({ ...t, backing: "public.CrmContact" })), OPTION_SETS, /org: backing/],
    ["선택지 legacyValue", OBJECT_TYPES, OPTION_SETS.map((s) => (s.key === "org_type" ? { ...s, options: s.options.map((o) => (o.key === "other" ? { ...o, legacyValue: "ETC" } : o)) } : s)), /org_type\.other: 기존 값/],
  ]
  for (const [name, types, sets, re] of cases) {
    const p = plan(db, types, sets)
    assert.equal(p.ops.length, 0, name)
    assert.match(p.errors.join("\n"), re, name)
  }
})

test("compareDefinitions — maxLength 를 줄이면 깨지고 늘리면 깨지지 않는다", () => {
  const def = (n: number) => ({ fields: [{ key: "title", maxLength: n }], optionSets: [] })
  assert.equal(compareDefinitions(def(300), def(200)).breaking, true)
  assert.equal(compareDefinitions(def(200), def(300)).breaking, false)
})

// ─── 마이그레이션 SQL · 스키마 ───

const MIGRATION = readFileSync(join(process.cwd(), "prisma/migrations/20261127200000_object_definitions/migration.sql"), "utf8")
const ROLLBACK = readFileSync(join(process.cwd(), "prisma/rollbacks/20261127200000_object_definitions.down.sql"), "utf8")
const TABLES = ["ObjectType", "ObjectField", "OptionValue", "ActionType", "ObjectTypeVersion"]

test("마이그레이션 SQL 은 다시 돌려도 된다 — IF NOT EXISTS · 제약은 지우고 다시 건다", () => {
  const sql = MIGRATION.replace(/--.*$/gm, "")
  for (const m of sql.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/g)) assert.fail(`IF NOT EXISTS 없는 CREATE: ${m[0]}`)
  const adds = [...sql.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)"/g)]
  assert.ok(adds.length >= 3)
  for (const [, table, name] of adds)
    assert.ok(sql.includes(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`), `${name}: 앞에 DROP CONSTRAINT IF EXISTS 가 없다`)
  // 기존 표를 바꾸지 않는다 — 새 표 다섯에만 쓴다
  for (const [, table] of sql.matchAll(/(?:ALTER TABLE|CREATE TABLE IF NOT EXISTS) "(\w+)"/g)) assert.ok(TABLES.includes(table), table)
  // 행을 쓰거나 지우는 문장이 없다(외래키의 ON DELETE · ON UPDATE 와 CHECK 의 문자열 값은 빼고 본다)
  const statements = sql.replace(/ON (DELETE|UPDATE) CASCADE/g, "").replace(/'[^']*'/g, "''")
  assert.doesNotMatch(statements, /\bDROP\s+TABLE\b|\bDROP\s+TYPE\b|\bUPDATE\b|\bDELETE\b|\bINSERT\b/i)
})

test("CHECK 값 목록이 lib/objects/define.ts 와 같다", () => {
  const inList = (constraint: string) => {
    const m = new RegExp(`"${constraint}" CHECK \\(([\\s\\S]*?)\\);`).exec(MIGRATION)
    assert.ok(m, constraint)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  assert.deepEqual(inList("ObjectType_storage_check"), [...STORAGES])
  assert.deepEqual(inList("ObjectType_visibilityPolicy_check"), [...VISIBILITY_POLICIES])
  assert.deepEqual(inList("ObjectField_dataType_check"), [...DATA_TYPES])
  assert.deepEqual(inList("ObjectField_frame_check"), [...FRAMES])
  assert.deepEqual(inList("ActionType_kind_check"), [...ACTION_KINDS])
  assert.deepEqual(inList("ActionType_risk_check"), [...ACTION_RISKS])
  for (const c of ["ObjectType_key_check", "ObjectField_key_check", "ActionType_key_check"])
    assert.deepEqual(inList(c), [KEY_PATTERN.source], c)
})

test("되돌리기 SQL 이 다섯 표와 마이그레이션 기록을 지운다", () => {
  for (const t of TABLES) assert.match(ROLLBACK, new RegExp(`DROP TABLE IF EXISTS "${t}";`), t)
  assert.match(ROLLBACK, /DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127200000_object_definitions';/)
})

test("Prisma 스키마에 정의 표 다섯이 있다", () => {
  const names = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name))
  for (const t of TABLES) assert.ok(names.has(t), t)
})
