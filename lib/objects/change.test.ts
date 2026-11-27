/**
 * P4 — 변경 이벤트를 공통 층 말로 바꾸는 순수 함수(색인 글 · 공개 범위 · 값 이력)와 마이그레이션 SQL 대조.
 * 실제 DB 에서의 트리거 · 소비기 확인은 scripts/verify-object-change.ts(PR 본문 · 보고서에 출력). 실행: pnpm test:unit
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Prisma } from "@/generated/prisma/client"
import { indexTextOf, revisionsOf, toFieldValue, visibilityOf, type ChangeRow } from "./change"
import { OBJECT_TYPES, OPTION_SET_MAP } from "./index"
import { backingModel } from "./backing"
import { AUTHOR_KINDS } from "./records"

const T = Object.fromEntries(OBJECT_TYPES.map((t) => [t.key, t]))
const ch = (over: Partial<ChangeRow>): ChangeRow => ({
  id: BigInt(7), op: "U", changedCols: [], oldValues: null, newValues: null, actorKind: "screen", ...over,
})

// ─── 순수 함수 ───

test("색인 글 — 「유형: 제목」 다음 칸 이름: 값, 고르기는 이름표 · 금액은 원 · 빈 칸과 ID 칸은 뺀다", () => {
  const { title, content } = indexTextOf(T.record, {
    id: "r1", title: "○○ 기술혁신 지원사업 선정", kind: "GRANT", organizer: "○○진흥원", startsOn: new Date("2026-03-02T00:00:00Z"),
    fundingKrw: BigInt(50_000_000), note: null, dedupeKey: "k", projectId: "p1", visibility: "INTERNAL",
  }, OPTION_SET_MAP)
  assert.equal(title, "연혁·실적 · ○○ 기술혁신 지원사업 선정")
  assert.match(content, /^연혁·실적: ○○ 기술혁신 지원사업 선정\n/)
  assert.match(content, /종류: 지원사업/)
  assert.match(content, /시작일: 2026-03-02/)
  assert.match(content, /지원금: 50,000,000원/)
  assert.match(content, /공개범위: 내부용 · 대외비/)
  assert.doesNotMatch(content, /중복 키|프로젝트: |비고: /)
})

test("공개 범위 — 연혁은 visibility 칸(INTERNAL → internal), 국가과제 · 기관은 유형 범위(빈 배열)", () => {
  assert.deepEqual(visibilityOf(T.record, { visibility: "INTERNAL" }), ["internal"])
  assert.deepEqual(visibilityOf(T.record, { visibility: "PUBLIC" }), [])
  assert.deepEqual(visibilityOf(T.grant_decision, {}), [])
  assert.deepEqual(visibilityOf(T.org, {}), [])
})

test("값 바꾸기 — 고르기는 기존 값 → 선택지 키, 모르는 값 · 금액 · 날짜", () => {
  const kind = T.record.fields.find((f) => f.key === "kind")!
  const money = T.record.fields.find((f) => f.key === "funding")!
  assert.equal(toFieldValue(kind, "AWARD", OPTION_SET_MAP), "award")
  assert.equal(toFieldValue(kind, "WHATEVER", OPTION_SET_MAP), "WHATEVER")
  assert.equal(toFieldValue(money, BigInt(1200), OPTION_SET_MAP), "1200")
  assert.equal(toFieldValue(money, null, OPTION_SET_MAP), null)
})

test("값 이력 — U 는 등록된 칸마다, 등록 안 된 칼럼은 버린다, 쓴 쪽 · changeId · 버전을 옮긴다", () => {
  const revs = revisionsOf(T.grant_decision, "g1", ch({
    changedCols: ["stage", "nasFolderBy", "note"],
    oldValues: { stage: "PREPARING", nasFolderBy: null, note: null },
    newValues: { stage: "SUBMITTED", nasFolderBy: "user", note: "제출" },
    actorKind: "source",
  }), 3, OPTION_SET_MAP)
  assert.deepEqual(revs.map((r) => [r.fieldKey, r.op, r.value, r.prevValue]), [
    ["stage", "update", "submitted", "preparing"],
    ["note", "update", "제출", null],
  ])
  assert.ok(revs.every((r) => r.authorKind === "source" && r.changeId === BigInt(7) && r.schemaVersion === 3 && r.objectId === "g1"))
  assert.deepEqual(revisionsOf(T.org, "o1", ch({ changedCols: ["billedOrgs"] }), 1, OPTION_SET_MAP), [])
})

test("값 이력 — I · D 는 대상 전체 한 줄, 칸 키로 바꾼 행", () => {
  const [c] = revisionsOf(T.org, "o1", ch({ op: "I", newValues: { id: "o1", name: "○○대학교", type: "UNIVERSITY", code: "ORG071", createdAt: "x" } }), 1, OPTION_SET_MAP)
  assert.equal(c.op, "create"); assert.equal(c.fieldKey, null)
  assert.deepEqual(c.value, { name: "○○대학교", type: "university", code: "ORG071" })
  const [d] = revisionsOf(T.org, "o1", ch({ op: "D", oldValues: { id: "o1", name: "○○대학교" } }), 1, OPTION_SET_MAP)
  assert.equal(d.op, "delete"); assert.equal(d.value, null); assert.deepEqual(d.prevValue, { name: "○○대학교" })
})

// ─── 마이그레이션 SQL ───

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")
const M1 = read("prisma/migrations/20261127235000_object_change/migration.sql")
const M2 = read("prisma/migrations/20261127235100_embedding_source_object/migration.sql")
const M3 = read("prisma/migrations/20261127235200_embedding_object_columns/migration.sql")
const R1 = read("prisma/rollbacks/20261127235000_object_change.down.sql")
const R3 = read("prisma/rollbacks/20261127235200_embedding_object_columns.down.sql")
const strip = (s: string) => s.replace(/--.*$/gm, "")

test("트리거를 건 표 = 등록 유형이 기대는 표(ChatMessage 는 아직 아니다)", () => {
  const triggered = [...strip(M1).matchAll(/CREATE TRIGGER "omnis_capture_change" AFTER INSERT OR UPDATE OR DELETE ON "(\w+)"/g)].map((m) => m[1]).sort()
  const backing = OBJECT_TYPES.map((t) => backingModel(t.backing!)!).sort()
  assert.deepEqual(triggered, backing)
  assert.ok(!triggered.includes("ChatMessage"))
  for (const t of triggered) {
    assert.ok(strip(M1).includes(`DROP TRIGGER IF EXISTS "omnis_capture_change" ON "${t}";`), `${t}: 다시 걸기 전 DROP`)
    assert.ok(strip(R1).includes(`DROP TRIGGER IF EXISTS "omnis_capture_change" ON "${t}";`), `${t}: 되돌리기`)
  }
  // 트리거가 기대는 id 칼럼 — 세 모델 모두 문자열 id
  for (const m of backing) {
    const id = Prisma.dmmf.datamodel.models.find((x) => x.name === m)!.fields.find((f) => f.name === "id")!
    assert.equal(id.type, "String", m)
  }
})

test("마이그레이션은 다시 돌려도 된다 · 잠금은 오래 기다리지 않는다 · 이름은 최종", () => {
  for (const [name, sql] of [["M1", M1], ["M3", M3]] as const) {
    const s = strip(sql)
    for (const m of s.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/g)) assert.fail(`${name}: IF NOT EXISTS 없는 CREATE: ${m[0]}`)
    for (const m of s.matchAll(/ADD COLUMN\s+(?!IF NOT EXISTS)/g)) assert.fail(`${name}: IF NOT EXISTS 없는 ADD COLUMN: ${m[0]}`)
    for (const [, t, c] of s.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)"/g))
      assert.ok(s.includes(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${c}"`), `${name}: ${c}`)
    assert.match(s, /^SET lock_timeout = '5s';$/m, `${name}: lock_timeout`)
  }
  assert.match(strip(M1), /CREATE OR REPLACE FUNCTION omnis_capture_change\(\)/)
  // enum 값 추가는 혼자 · IF NOT EXISTS — 같은 트랜잭션에서 그 값을 쓰지 않는다
  assert.equal(strip(M2).trim(), `ALTER TYPE "EmbeddingSource" ADD VALUE IF NOT EXISTS 'OBJECT';`)
  assert.doesNotMatch(strip(M3), /'OBJECT'/)
})

test("트리거 · outbox 의 쓴 쪽 값 = 값 이력의 authorKind", () => {
  const check = /"ObjectChange_actorKind_check" CHECK \("actorKind" IN \(([^)]*)\)\)/.exec(M1)![1]
  const inFn = /IF actor NOT IN \(([^)]*)\) THEN/.exec(M1)![1]
  const list = (s: string) => [...s.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()
  assert.deepEqual(list(check), [...AUTHOR_KINDS].sort())
  assert.deepEqual(list(inFn), [...AUTHOR_KINDS].sort())
  // updatedAt 만 바뀌면 남기지 않는다
  assert.match(M1, /e\.key <> 'updatedAt'/)
  assert.match(M1, /IF cardinality\(cols\) = 0 THEN\s+RETURN NEW;/)
})

test("되돌리기 — 트리거 · 함수 · outbox · 기록 줄, 칸 되돌리기는 OBJECT 조각까지 · enum 값은 남긴다", () => {
  assert.match(R1, /DROP FUNCTION IF EXISTS omnis_capture_change\(\);/)
  assert.match(R1, /DROP TABLE IF EXISTS "ObjectChange";/)
  assert.match(R1, /DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261127235000_object_change';/)
  assert.match(R3, /DELETE FROM "EmbeddingChunk" WHERE "source" = 'OBJECT';/)
  assert.match(R3, /DROP COLUMN IF EXISTS "typeKey"/)
  assert.doesNotMatch(strip(R3), /20261127235100_embedding_source_object/)
})
