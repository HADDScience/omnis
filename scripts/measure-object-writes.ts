/**
 * 공통 층 트리거(P4) 전후 쓰기 지연 — 로컬 스냅숏 복제 DB 에서만 돈다.
 *
 *   DATABASE_URL=…/omnis_onto_p4 npx tsx scripts/measure-object-writes.ts before
 *   (마이그레이션 적용) …                                              after
 *
 * 세 표는 화면이 실제로 부르는 쓰기를 쓴다: 연혁 = 라우트와 같은 prisma.companyRecord.update · create · delete,
 * 국가과제 = lib/grants updateGrantDecision, 기관 = lib/crm-ops updateOrg. EmbeddingChunk 는 syncEmbeddings 와 같은
 * INSERT … ON CONFLICT(벡터는 0 으로 채운 시험값, Gemini 를 부르지 않는다). 쓰기마다 걸린 시간을 재 p50 · p95 를 낸다.
 * 고친 칸(note)은 끝에 원래 값으로 돌린다. 계획: mydocs/plans/2026-11-27-ontology-phase1.md P4
 */
import "dotenv/config"
import { prisma } from "@/lib/db"
import { updateGrantDecision } from "@/lib/grants"
import { updateOrg } from "@/lib/crm-ops"

const LABEL = process.argv[2] ?? "run"
const N = Number(process.env.N ?? 100)
const WARM = 10

const url = process.env.DATABASE_URL ?? ""
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("로컬 DB 에서만 돈다 — 운영 · 데모를 가리키면 멈춘다")

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
async function timeIt(name: string, fn: (i: number) => Promise<unknown>) {
  for (let i = 0; i < WARM; i++) await fn(-1 - i)
  const ms: number[] = []
  for (let i = 0; i < N; i++) {
    const t = performance.now()
    await fn(i)
    ms.push(performance.now() - t)
  }
  return { name, n: N, p50: +q(ms, 0.5).toFixed(2), p95: +q(ms, 0.95).toFixed(2) }
}

async function main() {
  const db = (await prisma.$queryRawUnsafe<{ d: string; trg: number }[]>(
    `select current_database() d, (select count(*)::int from pg_trigger where tgname = 'omnis_capture_change') trg`
  ))[0]
  const user = await prisma.user.findFirstOrThrow({ select: { id: true } })
  const rec = await prisma.companyRecord.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true, note: true } })
  const dec = await prisma.grantDecision.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true, note: true } })
  const org = await prisma.crmOrg.findFirstOrThrow({ orderBy: { createdAt: "asc" }, select: { id: true, note: true } })

  const out = []
  out.push(await timeIt("CompanyRecord update(화면 PATCH 와 같은 update)", (i) =>
    prisma.companyRecord.update({ where: { id: rec.id }, data: { note: `측정 ${LABEL} ${i}` } })))
  out.push(await timeIt("CompanyRecord create + delete(화면 POST · DELETE)", async (i) => {
    const r = await prisma.companyRecord.create({
      data: { dedupeKey: `measure:${LABEL}:${i}:${Date.now()}`, kind: "MILESTONE", title: `측정 ${i}`, source: "측정" },
    })
    await prisma.companyRecord.delete({ where: { id: r.id } })
  }))
  out.push(await timeIt("GrantDecision updateGrantDecision(화면 PATCH)", async (i) => {
    const r = await updateGrantDecision(user.id, dec.id, { note: `측정 ${LABEL} ${i}` })
    if (!r.ok) throw new Error(`updateGrantDecision: ${JSON.stringify(r)}`)
  }))
  out.push(await timeIt("CrmOrg updateOrg(화면 PATCH)", async (i) => {
    const r = await updateOrg(org.id, { note: `측정 ${LABEL} ${i}` })
    if (!r.ok) throw new Error(`updateOrg: ${JSON.stringify(r)}`)
  }))
  const zero = `[${Array(768).fill(0).join(",")}]`
  out.push(await timeIt("EmbeddingChunk upsert(syncEmbeddings 와 같은 SQL)", (i) =>
    prisma.$executeRaw`
      INSERT INTO "EmbeddingChunk" ("id", "source", "sourceId", "chunkIndex", "title", "content", "contentHash", "embedding", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), 'TASK'::"EmbeddingSource", ${"measure-" + LABEL}, 0, ${"측정"}, ${"측정 " + i}, ${"h" + i}, ${zero}::vector, NOW(), NOW())
      ON CONFLICT ("source", "sourceId", "chunkIndex")
      DO UPDATE SET "title" = EXCLUDED."title", "content" = EXCLUDED."content", "contentHash" = EXCLUDED."contentHash", "embedding" = EXCLUDED."embedding", "updatedAt" = NOW()`))

  // 원래 값으로
  await prisma.companyRecord.update({ where: { id: rec.id }, data: { note: rec.note } })
  await prisma.grantDecision.update({ where: { id: dec.id }, data: { note: dec.note } })
  await prisma.crmOrg.update({ where: { id: org.id }, data: { note: org.note } })
  await prisma.embeddingChunk.deleteMany({ where: { sourceId: "measure-" + LABEL } })

  console.log(JSON.stringify({ label: LABEL, db: db.d, triggers: db.trg, results: out }, null, 1))
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
