/**
 * 옴니스 답의 출처 글을 DB 에서 읽는다 — 권한은 화면 · 도구와 같다:
 * 글은 visibleMessageWhere(전사방이거나 지금 참여자인 방), 첨부는 visibleFileWhere(방 참여자 · 전용 첨부).
 * 못 보는 글은 빠진다(있다는 것도 새지 않게). 규칙 · 모양은 lib/source-facts.ts.
 */
import type { Prisma } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { visibleMessageWhere } from "@/lib/chat-rooms"
import { PUBLIC_FILE_WHERE, visibleFileWhere } from "@/lib/file-access"
import { EXTERNAL_SPEAKER_SELECT, displayAuthor } from "@/lib/external-speaker"
import {
  MENTION_FILES_MAX,
  mentionedFileNames,
  pickMentionedFiles,
  sourceFact,
  sourceFactToolLine,
  type MentionCandidate,
  type SourceFact,
} from "@/lib/source-facts"

/** 한 번에 읽는 글 수 — 답 하나의 출처는 많아야 수십 개 */
export const SOURCE_FACTS_MAX = 40

export interface SourceFactOptions {
  /** 답이 여러 사람 앞에 남는 자리(질문 경로) — 참여자 전용 첨부는 싣지 않는다 */
  publicOnly?: boolean
}

export async function sourceMessageFacts(ids: string[], userId: string, opts: SourceFactOptions = {}): Promise<SourceFact[]> {
  const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))].slice(0, SOURCE_FACTS_MAX)
  if (unique.length === 0) return []
  const filesWhere: Prisma.FileWhereInput = opts.publicOnly ? { AND: [visibleFileWhere(userId), PUBLIC_FILE_WHERE] } : visibleFileWhere(userId)
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
      files: { where: filesWhere, select: { id: true, name: true, size: true, mimeType: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { files: true } },
    },
  })
  const names = new Map(rows.map((r) => [r.id, mentionedFileNames({ content: r.content, sourceId: r.sourceId, fileCount: r._count.files })]))
  const candidates = await mentionCandidates([...names.values()].flat(), userId, filesWhere)
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
        mentioned: pickMentionedFiles(names.get(r.id) ?? [], candidates, { userId, publicOnly: opts.publicOnly }),
      }),
    ]),
  )
  // 부른 순서대로
  return unique.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
}

/**
 * 이름이 같은 첨부 후보 — 볼 수 있는 파일 중, 안 붙었거나 볼 수 있는 글에 붙은 것. 같은 이름의 판이 많아도 한 쿼리로 끝나게 상한을 둔다.
 * 맥에서 올린 이름(NFD)도 잡도록 두 꼴로 찾는다. 고르기 · 권한 재확인은 pickMentionedFiles
 */
async function mentionCandidates(names: string[], userId: string, filesWhere: Prisma.FileWhereInput): Promise<MentionCandidate[]> {
  const forms = [...new Set(names.flatMap((n) => [n.normalize("NFC"), n.normalize("NFD")]))]
  if (forms.length === 0) return []
  const rows = await prisma.file.findMany({
    where: {
      AND: [
        filesWhere,
        { OR: forms.map((n) => ({ name: { equals: n, mode: "insensitive" as const } })) },
        { OR: [{ messageId: null }, { message: visibleMessageWhere(userId) }] },
      ],
    },
    select: {
      id: true, name: true, size: true, mimeType: true, createdAt: true, privateToUserId: true, taskId: true,
      message: { select: { id: true, roomId: true, taskId: true, deletedAt: true, room: { select: { members: { select: { userId: true } } } } } },
    },
    orderBy: { createdAt: "desc" },
    take: MENTION_FILES_MAX * 8,
  })
  return rows.map((f) => ({
    id: f.id, name: f.name, size: f.size, mimeType: f.mimeType, createdAt: f.createdAt, privateToUserId: f.privateToUserId, taskId: f.taskId,
    message: f.message
      ? { id: f.message.id, roomId: f.message.roomId, taskId: f.message.taskId, deleted: f.message.deletedAt !== null, roomMemberIds: f.message.room.members.map((m) => m.userId) }
      : null,
  }))
}

/**
 * 검색 결과(search_knowledge)의 채팅 조각 끝에 붙일 줄을 한 번에 — 원문 자리 · 바로가기 · 첨부 ID · 이름이 같은 파일.
 * 못 읽으면 줄 없이 간다(검색 결과 자체는 살린다). 돌려준 함수는 글 id 를 받아 「\n↳ 원문 …」 또는 빈 글
 */
export async function sourceFactSuffixes(messageIds: string[], userId: string, opts: SourceFactOptions = {}): Promise<(id: string | null) => string> {
  const facts = new Map((await sourceMessageFacts(messageIds, userId, opts).catch(() => [])).map((f) => [f.id, f]))
  return (id) => {
    const f = id ? facts.get(id) : undefined
    return f ? `\n${sourceFactToolLine(f)}` : ""
  }
}
