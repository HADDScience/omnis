// lib/import-actor.ts — 이식 스크립트 연결에 omnis.actor_kind=source 를 단다(공통 층 P4 트리거가 읽는다)
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { assertSourceActor, isNeonPooler, applySourceActor, withSourceActor } from "./import-actor"

const LOCAL = "postgresql://u:p@localhost:5433/omnis"
const DIRECT = "postgresql://u:p@ep-cool-x1.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
const POOLER = "postgresql://u:p@ep-cool-x1-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
const optionsOf = (url: string) => new URL(url).searchParams.get("options")

test("주소에 options 를 단다 — 다른 칸은 그대로", () => {
  assert.equal(optionsOf(withSourceActor(LOCAL)), "-c omnis.actor_kind=source")
  const d = new URL(withSourceActor(DIRECT))
  assert.equal(d.searchParams.get("sslmode"), "require")
  assert.equal(d.searchParams.get("options"), "-c omnis.actor_kind=source")
  assert.equal(d.hostname, "ep-cool-x1.c-4.ap-southeast-1.aws.neon.tech")
})

test("이미 있는 options 뒤에 잇고, 두 번 달아도 하나다", () => {
  const withTz = `${LOCAL}?options=${encodeURIComponent("-c timezone=UTC")}`
  assert.equal(optionsOf(withSourceActor(withTz)), "-c timezone=UTC -c omnis.actor_kind=source")
  const once = withSourceActor(LOCAL)
  assert.equal(withSourceActor(once), once)
  assert.throws(() => withSourceActor(`${LOCAL}?options=${encodeURIComponent("-c omnis.actor_kind=screen")}`), /다른 omnis\.actor_kind/)
})

test("Neon 풀러에는 달지 않는다", () => {
  assert.ok(isNeonPooler(POOLER))
  assert.ok(!isNeonPooler(DIRECT) && !isNeonPooler(LOCAL) && !isNeonPooler("not a url"))
  assert.throws(() => withSourceActor(POOLER), /풀러/)
})

test("applySourceActor — 풀러면 직결로 바꾸고, 직결이 없으면 멈춘다", () => {
  const env1: Record<string, string | undefined> = { DATABASE_URL: POOLER, POSTGRES_URL_NON_POOLING: DIRECT }
  assert.equal(applySourceActor(env1), "ep-cool-x1.c-4.ap-southeast-1.aws.neon.tech")
  assert.equal(new URL(env1.DATABASE_URL!).hostname, "ep-cool-x1.c-4.ap-southeast-1.aws.neon.tech")
  assert.equal(optionsOf(env1.DATABASE_URL!), "-c omnis.actor_kind=source")

  const env2: Record<string, string | undefined> = { DATABASE_URL: LOCAL }
  assert.equal(applySourceActor(env2), "localhost")
  assert.equal(optionsOf(env2.DATABASE_URL!), "-c omnis.actor_kind=source")

  assert.throws(() => applySourceActor({ DATABASE_URL: POOLER }), /직결/)
  assert.throws(() => applySourceActor({ DATABASE_URL: POOLER, POSTGRES_URL_NON_POOLING: POOLER }), /직결/)
  assert.throws(() => applySourceActor({}), /DATABASE_URL/)
})

test("assertSourceActor — source 가 아니면 멈춘다", async () => {
  const db = (k: string | null) => ({ $queryRawUnsafe: async <T,>() => [{ k }] as T })
  await assertSourceActor(db("source"))
  await assert.rejects(assertSourceActor(db(null)), /null/)
  await assert.rejects(assertSourceActor(db("screen")), /"screen"/)
})

test("세 표(CompanyRecord · GrantDecision · CrmOrg)에 쓰는 이식 스크립트는 prisma 보다 먼저 표시를 달고, 쓰기 전에 확인한다", () => {
  const scripts = {
    "scripts/import-grants.ts": { mark: 'import "@/lib/import-actor-env"', db: 'import { prisma } from "@/lib/db"' },
    "scripts/import-company-context.ts": { mark: 'import "@/lib/import-actor-env"', db: 'import { prisma } from "@/lib/db"' },
    "scripts/import-crm-xlsx.ts": { mark: 'import "../lib/import-actor-env"', db: "new PrismaClient()" },
    "scripts/backfill-billing-org.ts": { mark: "applySourceActor()", db: 'await import("../lib/db")' },
  }
  for (const [file, { mark, db }] of Object.entries(scripts)) {
    const src = readFileSync(file, "utf8")
    const m = src.indexOf(mark)
    const d = src.indexOf(db)
    assert.ok(m >= 0, `${file}: 표시가 없다`)
    assert.ok(d > m, `${file}: prisma 가 표시보다 먼저다`)
    assert.match(src, /async function main\(\) \{\n {2}await assertSourceActor\(prisma\)\n/, `${file}: main 첫 줄 확인이 없다`)
  }
})
