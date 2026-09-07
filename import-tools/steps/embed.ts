// 6단계 — 이식된 업무·메시지를 옴니스 AI 검색 색인에 싣는다.
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

export async function embed(opts: { dry: boolean }) {
  const [tasks, messages] = await Promise.all([
    prisma.task.findMany({ where: { sourceId: { startsWith: "kakao-task:" }, archived: false }, select: { id: true } }),
    // 색인 조건은 lib/embeddings 의 buildChatMessageChunks 와 같다. 전량을 고르고 해시로
    // 거른다 — 청크 형식이 바뀌면(예: 시각 추가) 이미 색인된 것도 다시 실어야 한다.
    prisma.$queryRaw<{ id: string }[]>`
      SELECT m."id" FROM "ChatMessage" m
      WHERE m."sourceId" LIKE 'kakao:%' AND m."kind" = 'NORMAL'
        AND length(trim(m."content")) >= ${CHAT_MIN_LENGTH}
        AND m."content" NOT LIKE '\\_\\_%' AND m."content" NOT LIKE '🤖%'
      ORDER BY m."createdAt"`,
  ])
  const taskIds = tasks.map((t) => t.id)
  const [noTask, noMsg] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "Task" t WHERE t."sourceId" LIKE 'kakao-task:%' AND t."archived" = false
      AND NOT EXISTS (SELECT 1 FROM "EmbeddingChunk" e WHERE e."source" = 'TASK' AND e."sourceId" = t."id")`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint n FROM "ChatMessage" m WHERE m."id" IN (${Prisma.join(messages.map((x) => x.id))})
      AND NOT EXISTS (SELECT 1 FROM "EmbeddingChunk" e WHERE e."source" = 'CHAT_MESSAGE' AND e."sourceId" = m."id")`,
  ])
  console.log(`  업무 ${taskIds.length}건 (색인 없는 것 ${Number(noTask[0].n)}) · 메시지 ${messages.length}건 (색인 없는 것 ${Number(noMsg[0].n)})`)
  console.log(`  Gemini 호출 최대 ≈ ${Math.ceil(taskIds.length / 100) + Math.ceil(messages.length / 100)}회 (바뀐 것만 부른다)`)
  if (opts.dry) return

  // 업무는 전량 동기화한다 — 상태·체크리스트가 바뀐 카드도 해시 비교로 갱신된다.
  const t = await syncEmbeddingsBatch("TASK", taskIds, {
    onProgress: (d, n) => process.stdout.write(`\r  업무 ${d}/${n}`),
  })
  console.log(`\r  업무 — 새로 ${t.embedded} · 그대로 ${t.unchanged} · 제거 ${t.removed}`)

  const m = await syncEmbeddingsBatch("CHAT_MESSAGE", messages.map((x) => x.id), {
    onProgress: (d, n) => process.stdout.write(`\r  메시지 ${d}/${n}`),
  })
  console.log(`\r  메시지 — 새로 ${m.embedded} · 그대로 ${m.unchanged} · 제거 ${m.removed}`)
}
