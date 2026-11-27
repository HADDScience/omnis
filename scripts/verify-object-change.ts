/**
 * 공통 층 트리거 · 소비기(P4) 확인 — 로컬 스냅숏 복제 DB 에서만 돈다. 세 표를 화면이 부르는 쓰기로 고치고
 * ObjectChange · ObjectRevision · OBJECT 조각이 기대대로인지 본다. 끝에 고친 값을 되돌린다.
 *
 *   DATABASE_URL=…/omnis_onto_p4 npx tsx scripts/verify-object-change.ts
 *
 * 소비기의 임베딩은 결정적인 가짜 벡터로 바꿔 돈다(Gemini 를 부르지 않는다 — 2026-11-27 로컬 개발 키 선불 크레딧이
 * 바닥나 402). 실제 임베딩 경로(lib/ai embedTexts)는 기존 색인과 같은 함수라 여기서 다시 보지 않는다.
 * 계획: mydocs/plans/2026-11-27-ontology-phase1.md P4
 */
import "dotenv/config"
import assert from "node:assert/strict"
import { prisma } from "@/lib/db"
import { PrismaClient } from "@/generated/prisma/client"
import { updateGrantDecision } from "@/lib/grants"
import { updateOrg } from "@/lib/crm-ops"
import { createHash } from "node:crypto"
import { processObjectChanges, reconcileObjectIndex, type EmbedFn } from "@/lib/objects/consumer"

/** 글마다 같은 768 차원 벡터 — 확인용 */
const fakeEmbed: EmbedFn = async (texts) =>
  texts.map((t) => {
    const h = createHash("sha256").update(t).digest()
    return Array.from({ length: 768 }, (_, i) => (h[i % h.length] - 128) / 128)
  })

const url = process.env.DATABASE_URL ?? ""
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("로컬 DB 에서만 돈다")

const lastChange = () => prisma.objectChange.findFirst({ orderBy: { id: "desc" } })
const results: string[] = []
const ok = (name: string) => { results.push(`✔ ${name}`); console.log(`✔ ${name}`) }

async function main() {
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } })
  const rec = await prisma.companyRecord.findFirstOrThrow({ orderBy: { createdAt: "asc" } })
  const dec = await prisma.grantDecision.findFirstOrThrow({ orderBy: { createdAt: "asc" } })
  const org = await prisma.crmOrg.findFirstOrThrow({ orderBy: { createdAt: "asc" } })
  // 앞선 측정이 남긴 변경은 처리된 것으로 본다(이 확인은 지금 만드는 변경만 본다)
  await prisma.objectChange.updateMany({ where: { processedAt: null }, data: { processedAt: new Date() } })
  const startId = (await lastChange())?.id ?? BigInt(0)
  try {

  // 1. 연혁 — 화면 PATCH 와 같은 update
  const newKind = rec.kind === "AWARD" ? "FORUM" : "AWARD"
  await prisma.companyRecord.update({ where: { id: rec.id }, data: { title: rec.title + " (확인)", kind: newKind } })
  let c = await lastChange()
  assert.equal(c?.tableName, "public.CompanyRecord"); assert.equal(c?.op, "U"); assert.equal(c?.rowId, rec.id)
  assert.equal(c?.actorKind, "screen")
  assert.ok(c!.changedCols.includes("title") && !c!.changedCols.includes("updatedAt"), JSON.stringify(c!.changedCols))
  assert.equal((c!.oldValues as Record<string, unknown>).title, rec.title)
  assert.equal((c!.newValues as Record<string, unknown>).title, rec.title + " (확인)")
  ok(`연혁 update → U · screen · changedCols ${c!.changedCols.join(",")} · 앞뒤 값`)

  // 2. updatedAt 만 바뀐 UPDATE 는 남기지 않는다
  const before2 = (await lastChange())!.id
  await prisma.$executeRaw`UPDATE "CompanyRecord" SET "updatedAt" = NOW() WHERE "id" = ${rec.id}`
  assert.equal((await lastChange())!.id, before2)
  ok("updatedAt 만 바뀐 UPDATE → 남기지 않음")

  // 3. 되돌린 트랜잭션의 변경은 남지 않는다(같은 트랜잭션 outbox)
  await prisma.$transaction(async (tx) => {
    await tx.companyRecord.update({ where: { id: rec.id }, data: { note: "되돌릴 것" } })
    throw new Error("rollback")
  }).catch(() => {})
  assert.equal((await lastChange())!.id, before2)
  ok("되돌린 트랜잭션 → 남지 않음")

  // 4. 국가과제 — lib/grants updateGrantDecision(화면 PATCH)
  const stage = dec.stage === "PREPARING" ? "SUBMITTED" : "PREPARING"
  const r = await updateGrantDecision(user.id, dec.id, { stage })
  assert.ok(r.ok, JSON.stringify(r))
  c = await lastChange()
  assert.equal(c?.tableName, "public.GrantDecision"); assert.ok(c!.changedCols.includes("stage"))
  ok(`국가과제 updateGrantDecision → U · changedCols ${c!.changedCols.join(",")}`)

  // 5. 기관 — lib/crm-ops updateOrg(화면 PATCH)
  const o = await updateOrg(org.id, { note: (org.note ?? "") + " (확인)" })
  assert.ok(o.ok, JSON.stringify(o))
  c = await lastChange()
  assert.equal(c?.tableName, "public.CrmOrg"); assert.deepEqual(c!.changedCols, ["note"])
  ok("기관 updateOrg → U · changedCols note")

  // 6. 만들기 · 지우기 — I 는 행 전체를 newValues, D 는 oldValues
  const made = await prisma.companyRecord.create({ data: { dedupeKey: `verify:${Date.now()}`, kind: "MILESTONE", title: "확인용 연혁", source: "확인" } })
  c = await lastChange()
  assert.equal(c?.op, "I"); assert.equal((c!.newValues as Record<string, unknown>).title, "확인용 연혁")
  await prisma.companyRecord.delete({ where: { id: made.id } })
  c = await lastChange()
  assert.equal(c?.op, "D"); assert.equal((c!.oldValues as Record<string, unknown>).id, made.id)
  ok("연혁 create → I(행 전체) · delete → D(지운 행 전체)")

  // 7. 쓴 쪽 = source — 이식 스크립트처럼 연결 주소 options 로(lib/import-actor.ts 와 같은 방법)
  const u = new URL(url); u.searchParams.set("options", "-c omnis.actor_kind=source")
  const src = new PrismaClient({ datasourceUrl: u.toString() })
  await src.crmOrg.update({ where: { id: org.id }, data: { address: (org.address ?? "") + " " } })
  await src.$disconnect()
  c = await lastChange()
  assert.equal(c?.actorKind, "source")
  ok("options -c omnis.actor_kind=source 연결 → actorKind source")

  // 8. 모르는 값은 screen 으로
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL omnis.actor_kind = 'bogus'")
    await tx.crmOrg.update({ where: { id: org.id }, data: { address: org.address } })
  })
  c = await lastChange()
  assert.equal(c?.actorKind, "screen")
  ok("모르는 actor_kind('bogus') → screen")

  // 9. 소비기 — 값 이력 · 색인
  const made2 = await prisma.objectChange.count({ where: { id: { gt: startId } } })
  const res = await processObjectChanges({ limit: 100, embed: fakeEmbed })
  assert.equal(res.failed + res.indexFailed, 0, JSON.stringify(res)); assert.equal(res.processed, made2)
  const revs = await prisma.objectRevision.findMany({ where: { changeId: { gt: startId } }, orderBy: { changeId: "asc" } })
  const title = revs.find((x) => x.typeKey === "record" && x.fieldKey === "title")
  assert.equal(title?.authorKind, "screen"); assert.equal(title?.value, rec.title + " (확인)"); assert.equal(title?.prevValue, rec.title)
  const kind = revs.find((x) => x.typeKey === "record" && x.fieldKey === "kind")
  assert.equal(kind?.value, newKind.toLowerCase(), "고르기 칸은 선택지 키로")
  assert.equal(kind?.prevValue, rec.kind.toLowerCase())
  assert.ok(revs.some((x) => x.typeKey === "org" && x.fieldKey === "address" && x.authorKind === "source"))
  assert.ok(revs.some((x) => x.op === "create" && x.fieldKey === null) && revs.some((x) => x.op === "delete" && x.fieldKey === null))
  const chunk = await prisma.embeddingChunk.findFirst({ where: { source: "OBJECT", sourceId: `record:${rec.id}` } })
  assert.ok(chunk?.content.includes("(확인)") && chunk.typeKey === "record")
  ok(`소비기 → 처리 ${res.processed} · 이력 ${res.revisions}(title screen 앞뒤 값 · kind 선택지 키 · org.address source · create · delete) · 색인 ${res.embedded} · 지움 ${res.removed}`)

  // 10. 다시 돌려도 겹치지 않는다
  await prisma.objectChange.updateMany({ where: { id: { gt: startId } }, data: { processedAt: null } })
  const again = await processObjectChanges({ limit: 100, embed: fakeEmbed })
  assert.equal(again.revisions, 0); assert.equal(again.embedded, 0)
  ok(`같은 변경을 다시 처리 → 이력 ${again.revisions} · 임베딩 ${again.embedded}`)

  // 11. 대조 — 처음은 등록 유형 행 전부, 두 번째는 0
  const rc1 = await reconcileObjectIndex(fakeEmbed)
  const rc2 = await reconcileObjectIndex(fakeEmbed)
  assert.equal(rc2.embedded, 0)
  ok(`대조 1회 → 행 ${rc1.rows} · 임베딩 ${rc1.embedded} · 그대로 ${rc1.unchanged} / 2회 → 임베딩 ${rc2.embedded}`)

  // 12. 임베딩이 실패해도 이력 · 처리 표시는 남고 lastError 만 적힌다
  await prisma.crmOrg.update({ where: { id: org.id }, data: { note: (org.note ?? "") + " (임베딩 실패 시험)" } })
  const failing: EmbedFn = async () => { throw new Error("시험용 임베딩 실패") }
  const f = await processObjectChanges({ limit: 100, embed: failing })
  assert.equal(f.processed, 1); assert.equal(f.indexFailed, 1); assert.equal(f.failed, 0)
  const fc = await lastChange()
  assert.ok(fc?.processedAt && fc.attempts === 0 && fc.lastError?.startsWith("색인 실패"), `processedAt ${fc?.processedAt?.toISOString()} · attempts ${fc?.attempts} · lastError ${fc?.lastError}`)
  assert.ok(await prisma.objectRevision.findFirst({ where: { changeId: fc!.id, fieldKey: "note" } }))
  ok("임베딩 실패 → 이력 남음 · processedAt 찍힘 · attempts 0 · lastError 「색인 실패」")

  console.log(`\n${results.length}개 확인 통과`)
  } finally {
    // 되돌리기(원래 값) — 중간에 멈춰도
    await prisma.companyRecord.update({ where: { id: rec.id }, data: { title: rec.title, kind: rec.kind } })
    await prisma.grantDecision.update({ where: { id: dec.id }, data: { stage: dec.stage } })
    await prisma.crmOrg.update({ where: { id: org.id }, data: { note: org.note, address: org.address } })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
