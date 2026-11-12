/**
 * 답장 인용(원글 미리보기)을 눌렀을 때 어디로 갈지.
 * - 원글이 지워졌으면 갈 곳이 없다 — 「원래 메시지를 찾을 수 없어요」
 * - 지금 불러온 범위 안이면 그 자리로(다시 받지 않는다)
 * - 범위 밖이면 그 글 앞뒤를 불러와서(검색 이동 · #m-<id> 와 같은 길)
 */
export const REPLY_TARGET_MISSING = "원래 메시지를 찾을 수 없어요"

export type ReplyJump = "missing" | "here" | "load"

export function replyJump(
  replyTo: { id: string; deleted?: boolean },
  loaded: ReadonlyArray<{ id: string; deletedAt?: string | null }>,
): ReplyJump {
  if (replyTo.deleted) return "missing"
  const hit = loaded.find((m) => m.id === replyTo.id)
  if (hit) return hit.deletedAt ? "missing" : "here"
  return "load"
}

/** 주변 불러오기가 실패했을 때의 안내. 없는 글 · 볼 수 없는 방(404 · 403)은 원글이 없는 것과 같다 */
export function aroundFailureMessage(status: number | null): string {
  return status === 404 || status === 403 ? REPLY_TARGET_MISSING : "그 메시지를 불러오지 못했습니다"
}
