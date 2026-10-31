/**
 * 다시 보내기 중복 막기 — 같은 clientId 로 이미 저장된 글이 있을 때 어떻게 할지(순수 함수).
 *
 * 응답만 끊긴 글을 화면이 다시 보내면 서버에는 이미 그 글이 있다. 그때는 새로 만들지 않고 **처음 글을 그대로 돌려준다**
 * — 화면은 그것으로 말풍선을 확정한다. 알림 · 업무 재구성도 다시 돌지 않는다(처음 저장 때 이미 돌았다).
 *
 * 남의 글이거나 다른 방 글이면 돌려주지 않는다. clientId 는 화면이 만든 값이라 남의 id 를 넣어 남의 글을 읽을 수 있으면 안 된다.
 */

export type ClientIdDecision = "new" | "replay" | "conflict"

export function decideClientId(
  prior: { authorId: string; roomId: string } | null,
  me: { userId: string; roomId: string },
): ClientIdDecision {
  if (!prior) return "new"
  if (prior.authorId !== me.userId || prior.roomId !== me.roomId) return "conflict"
  return "replay"
}

/** Prisma 고유 제약 위반(P2002) — 같은 clientId 를 두 요청이 동시에 저장하려 한 경우 */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002"
}
