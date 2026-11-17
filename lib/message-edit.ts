// 채팅 글 고치기 · 지우기 규칙 — DB 없이 시험한다. 라우트는 app/api/chat/messages/[messageId]/route.ts.
//
// 2026-11-17: 고칠 때 원문을 ChatMessageRevision 에 남기고(관리자 감사), 카톡에서 옮겨 온 글은 고치지 못하게 했다.
// 카톡 글은 카톡에 있는 원문과 같아야 한다 — 옴니스에서 고치면 두 기록이 어긋나고, 다시 이식할 때 기준이 흔들린다.
import { timeLabel } from "@/lib/chat-layout"

export interface ChangeTarget {
  authorId: string
  kind: string
  content: string
  deletedAt: Date | null
  sourceId?: string | null
}

/** 카톡에서 옮겨 온 글인가 — 이식은 sourceId 를 "kakao:<sha1>" 로 남긴다 */
export function isKakaoMessage(m: { sourceId?: string | null }): boolean {
  return !!m.sourceId?.startsWith("kakao:")
}

/** 손댈 수 있는 글인지. 막을 이유가 있으면 그 문장을 돌려준다 */
export function messageChangeRefusal(message: ChangeTarget, userId: string, action: "edit" | "delete"): string | null {
  if (message.authorId !== userId) return "내가 쓴 글만 고치거나 지울 수 있습니다"
  if (message.kind !== "NORMAL") return "옴니스가 남긴 글은 고치거나 지울 수 없습니다"
  if (message.content.startsWith("__TASK_CREATED__:")) return "업무 카드는 고치거나 지울 수 없습니다"
  if (message.content.startsWith("🤖")) return "옴니스가 남긴 글은 고치거나 지울 수 없습니다"
  if (message.deletedAt) return "이미 지운 글입니다"
  if (action === "edit" && isKakaoMessage(message)) return "카톡에서 옮겨 온 글은 고칠 수 없습니다"
  return null
}

/** 화면에서 「수정」 을 보일 글인가 — 서버 규칙 중 화면이 아는 것만(글쓴이 · 지움 · 카톡) */
export function canEditInView(m: { authorId: string; deletedAt?: string | Date | null; sourceId?: string | null }, userId: string | undefined): boolean {
  return !!userId && m.authorId === userId && !m.deletedAt && !isKakaoMessage(m)
}

/**
 * 「수정됨」 옆에 붙일 고친 시각. 보낸 날과 같은 날 고쳤으면 시각만, 다른 날이면 날짜까지.
 * 시간대는 화면(브라우저) 기준 — MessageTime 과 같다
 */
export function editedLabel(createdAt: Date, editedAt: Date): string {
  const sameDay =
    createdAt.getFullYear() === editedAt.getFullYear() &&
    createdAt.getMonth() === editedAt.getMonth() &&
    createdAt.getDate() === editedAt.getDate()
  return sameDay ? `수정됨 ${timeLabel(editedAt)}` : `수정됨 ${editedAt.getMonth() + 1}월 ${editedAt.getDate()}일 ${timeLabel(editedAt)}`
}
