// 7단계 — 이식된 업무·메시지·사진을 옴니스 AI 검색 색인에 싣는다.
//
// 이식 경로 안에서 임베딩을 타지 않는 원칙(부수효과 없음)은 그대로다. 이건 이식이 끝난
// 뒤 명시적으로 도는 마지막 단계이고, `--no-embed` 로 뺄 수 있다.
// 안 돌리면 옴니스 AI 가 이식 자료를 못 찾는다 — 처음 이식 때 채팅 9천 건 중 79건만
// 색인돼 있었던 것이 그 결과다.
import { Prisma } from "../../generated/prisma"
import { prisma } from "../kakao-common"
import { syncEmbeddingsBatch } from "../../lib/embeddings"

/** 앱의 채팅 청킹 규칙과 같은 조건 — 짧은 잡담·시스템 메시지는 색인하지 않는다. */
const CHAT_MIN_LENGTH = 15

export async function embed(opts: { dry: boolean; photoIds?: string[] }): Promise<{ photosLeft: number }> {
  const reembedAll = process.env.KAKAO_REEMBED_ALL === "1"
  const [tasks, messages] = await Promise.all([
    // 업무도 같은 이유로 — 색인이 없거나 마지막 색인 뒤에 고쳐진 카드만. 전량은 KAKAO_REEMBED_ALL=1
    prisma.$queryRaw<{ id: string }[]>`
      SELECT t."id" FROM "Task" t
      WHERE t."sourceId" LIKE 'kakao-task:%' AND t."archived" = false
        AND (${reembedAll} OR t."updatedAt" > COALESCE(
          (SELECT max(e."updatedAt") FROM "EmbeddingChunk" e WHERE e."source" = 'TASK' AND e."sourceId" = t."id"), 'epoch'::timestamp))`,
    // 색인 조건은 lib/embeddings 의 buildChatMessageChunks 와 같다 — 전사방 글만.
    // 기본은 색인이 없는 글만 고른다. 전량을 하나씩 확인하면 방마다 8천 건을 운영 DB 에서 읽어 2시간 넘게 걸렸다(2026-10-30).
    // 청크 형식이 바뀌어(예: 시각 추가) 이미 색인된 것도 다시 실어야 하면 KAKAO_REEMBED_ALL=1 로 전량을 해시 비교한다.
    prisma.$queryRaw<{ id: string }[]>`
      SELECT m."id" FROM "ChatMessage" m JOIN "ChatRoom" r ON r."id" = m."roomId"
      WHERE m."sourceId" LIKE 'kakao:%' AND m."kind" = 'NORMAL' AND m."deletedAt" IS NULL AND r."kind" = 'COMPANY' AND m."externalSpeakerId" IS NULL
        AND length(trim(m."content")) >= ${CHAT_MIN_LENGTH}
        AND m."content" NOT LIKE '\\_\\_%' AND m."content" NOT LIKE '🤖%'
        AND (${reembedAll} OR NOT EXISTS (SELECT 1 FROM "EmbeddingChunk" e WHERE e."source" = 'CHAT_MESSAGE' AND e."sourceId" = m."id"))
      ORDER BY m."createdAt"`,
  ])
  const taskIds = tasks.map((t) => t.id)
  const [noTask, noMsg] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Task" t WHERE t."sourceId" LIKE 'kakao-task:%' AND t."archived" = false
      AND NOT EXISTS (SELECT 1 FROM "EmbeddingChunk" e WHERE e."source" = 'TASK' AND e."sourceId" = t."id")`,
    messages.length === 0 ? [{ n: BigInt(0) }] : prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "ChatMessage" m WHERE m."id" IN (${Prisma.join(messages.map((x) => x.id))})
      AND NOT EXISTS (SELECT 1 FROM "EmbeddingChunk" e WHERE e."source" = 'CHAT_MESSAGE' AND e."sourceId" = m."id")`,
  ])
  console.log(`  업무 ${taskIds.length}건 (색인 없는 것 ${Number(noTask[0].n)}) · 메시지 ${messages.length}건 (색인 없는 것 ${Number(noMsg[0].n)})`)
  console.log(`  Gemini 호출 최대 ≈ ${Math.ceil(taskIds.length / 100) + Math.ceil(messages.length / 100)}회 (바뀐 것만 부른다)`)
  if (opts.dry) return { photosLeft: 0 }

  // 업무는 전량 동기화한다 — 상태·체크리스트가 바뀐 카드도 해시 비교로 갱신된다.
  const t = await syncEmbeddingsBatch("TASK", taskIds, {
    onProgress: (d, n) => process.stdout.write(`\r  업무 ${d}/${n}`),
  })
  console.log(`\r  업무 — 새로 ${t.embedded} · 그대로 ${t.unchanged} · 제거 ${t.removed}`)

  const m = await syncEmbeddingsBatch("CHAT_MESSAGE", messages.map((x) => x.id), {
    onProgress: (d, n) => process.stdout.write(`\r  메시지 ${d}/${n}`),
  })
  console.log(`\r  메시지 — 새로 ${m.embedded} · 그대로 ${m.unchanged} · 제거 ${m.removed}`)

  // 사진도 설명이 있는데 색인이 없는 것만. 실패해도 이식은 끝난다 — 다음 실행에서 다시 고른다
  const photoIds = opts.photoIds ?? []
  const indexed = new Set((await prisma.embeddingChunk.findMany({ where: { source: "PHOTO", sourceId: { in: photoIds } }, select: { sourceId: true } })).map((c) => c.sourceId))
  const described = await prisma.file.findMany({ where: { id: { in: photoIds }, describedAt: { not: null } }, select: { id: true } })
  const photos = described.map((f) => f.id).filter((id) => reembedAll || !indexed.has(id))
  try {
    const p = await syncEmbeddingsBatch("PHOTO", photos, {
      onProgress: (d, n) => process.stdout.write(`\r  사진 ${d}/${n}`),
    })
    console.log(`\r  사진 — 새로 ${p.embedded} · 그대로 ${p.unchanged} · 제거 ${p.removed}`)
    return { photosLeft: 0 }
  } catch (e) {
    console.log(`\r  ✗ 사진 색인 ${photos.length}장 실패 — ${(e as Error).message.split("\n")[0].slice(0, 160)}`)
    return { photosLeft: photos.length }
  }
}
