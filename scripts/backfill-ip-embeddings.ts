/**
 * 지식재산권 건을 옴니스 지식 검색에 색인한다.
 *
 *   TARGET_DB="<접속문자열>" GEMINI_API_KEY="..." npx tsx scripts/backfill-ip-embeddings.ts
 *
 * 한 번 돌리면 되는 백필이다. 이후의 변경은 API 라우트가 저장할 때마다
 * syncEmbeddings 를 불러 따라간다.
 *
 * 이미 색인된 건은 내용 해시가 같으면 Gemini 를 다시 부르지 않는다(syncEmbeddings).
 * 그래서 다시 돌려도 비용이 들지 않고, 중간에 끊겨도 이어서 돌리면 된다.
 *
 * DB 에서 사라진 건의 잔재도 함께 지운다 — 지운 상표가 검색에 계속 잡히면
 * "우리 상표 목록"을 묻는 답이 조용히 틀린다.
 */
import { allIpCaseKeys, syncEmbeddings } from "../lib/embeddings"
import { prisma } from "../lib/db"

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY 가 없습니다. 임베딩을 만들 수 없습니다.")
    process.exit(1)
  }

  const keys = await allIpCaseKeys()
  console.log(`지식재산권 ${keys.length}건을 색인합니다.\n`)

  let ok = 0
  let failed = 0
  for (const key of keys) {
    try {
      await syncEmbeddings("IP_CASE", key)
      ok++
      console.log(`  ✓ ${key}`)
    } catch (err) {
      failed++
      console.log(`  ✗ ${key} — ${(err as Error).message}`)
    }
  }

  // 사라진 건의 잔재 정리
  const indexed = await prisma.embeddingChunk.findMany({
    where: { source: "IP_CASE" },
    select: { sourceId: true },
    distinct: ["sourceId"],
  })
  const live = new Set(keys)
  const stale = indexed.map((r) => r.sourceId).filter((id) => !live.has(id))
  if (stale.length > 0) {
    await prisma.embeddingChunk.deleteMany({
      where: { source: "IP_CASE", sourceId: { in: stale } },
    })
    console.log(`\n사라진 건 ${stale.length}개의 색인을 지웠습니다: ${stale.join(", ")}`)
  }

  const total = await prisma.embeddingChunk.count({ where: { source: "IP_CASE" } })
  console.log(`\n완료: 성공 ${ok}건, 실패 ${failed}건 · 색인된 청크 ${total}개`)

  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
