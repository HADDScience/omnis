import type { Prisma } from "@/generated/prisma/client"
import { attachAwareText } from "@/lib/attachment-text"
import { CHAT_DELETED_TEXT } from "@/lib/constants"
import { displayAuthor, EXTERNAL_SPEAKER_SELECT } from "@/lib/external-speaker"

// 글 한 줄의 모양 — 글 API 와 방 화면이 같은 것을 쓴다. 다르면 방 화면이 준 글과 폴링이 준 글의 칸이 어긋난다

export const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true } },
  externalSpeaker: EXTERNAL_SPEAKER_SELECT,
  // TASK_CREATED 메시지가 생성된 업무의 프리뷰 카드를 그릴 수 있도록 핵심 필드 포함
  task: {
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      priority: true,
      deadline: true,
      assignees: { select: { user: { select: { id: true, name: true } } } },
      _count: { select: { checklists: true } },
    },
  },
  files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
  replyTo: { select: { id: true, content: true, deletedAt: true, _count: { select: { files: true } }, author: { select: { name: true } }, externalSpeaker: EXTERNAL_SPEAKER_SELECT } },
} satisfies Prisma.ChatMessageInclude

export type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>

// 지운 글은 자리만 남긴다 — 본문과 첨부는 내려보내지 않는다(행은 DB 에 그대로 있다)
export function shapeMessage({ externalSpeaker, ...m }: MessageRow) {
  return {
    ...m,
    author: displayAuthor(m.author, externalSpeaker),
    content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
    files: m.deletedAt ? [] : m.files,
    replyTo: m.replyTo
      ? {
          id: m.replyTo.id,
          authorName: displayAuthor({ id: "", name: m.replyTo.author.name }, m.replyTo.externalSpeaker).name,
          content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : attachAwareText(m.replyTo.content, m.replyTo._count.files).slice(0, 80),
          deleted: !!m.replyTo.deletedAt,
        }
      : null,
  }
}
