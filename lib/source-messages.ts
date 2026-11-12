/**
 * 옴니스 답의 출처 글을 DB 에서 읽는다 — 권한은 화면 · 도구와 같다:
 * 글은 visibleMessageWhere(전사방이거나 지금 참여자인 방), 첨부는 visibleFileWhere(방 참여자 · 전용 첨부).
 * 못 보는 글은 빠진다(있다는 것도 새지 않게). 규칙 · 모양은 lib/source-facts.ts.
 */
import { prisma } from "@/lib/db"
import { visibleMessageWhere } from "@/lib/chat-rooms"
import { visibleFileWhere } from "@/lib/file-access"
import { EXTERNAL_SPEAKER_SELECT, displayAuthor } from "@/lib/external-speaker"
import { sourceFact, type SourceFact } from "@/lib/source-facts"

/** 한 번에 읽는 글 수 — 답 하나의 출처는 많아야 수십 개 */
export const SOURCE_FACTS_MAX = 40

export async function sourceMessageFacts(ids: string[], userId: string): Promise<SourceFact[]> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, SOURCE_FACTS_MAX)
  if (unique.length === 0) return []
  const rows = await prisma.chatMessage.findMany({
    where: { id: { in: unique }, deletedAt: null, ...visibleMessageWhere(userId) },
    select: {
      id: true,
      roomId: true,
      taskId: true,
      sourceId: true,
      content: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
      externalSpeaker: EXTERNAL_SPEAKER_SELECT,
      room: { select: { kind: true, name: true } },
      task: { select: { name: true } },
      files: { where: visibleFileWhere(userId), select: { id: true, name: true, size: true, mimeType: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { files: true } },
    },
  })
  const byId = new Map(
    rows.map((r) => [
      r.id,
      sourceFact({
        id: r.id,
        roomId: r.roomId,
        taskId: r.taskId,
        sourceId: r.sourceId,
        content: r.content,
        createdAt: r.createdAt,
        author: displayAuthor(r.author, r.externalSpeaker).name,
        room: { kind: r.room.kind, name: r.room.name },
        task: r.task,
        files: r.files,
        fileCount: r._count.files,
      }),
    ]),
  )
  // 부른 순서대로
  return unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}
