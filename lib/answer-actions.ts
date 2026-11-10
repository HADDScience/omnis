/**
 * 옴니스 답 아래 동작 줄의 규칙 — 시각 표기 · 사내 링크. 순수 함수 — 시험: answer-actions.test.ts
 */

/** 「11월 10일, 오후 2:47」 — 서울 기준 */
export function answerTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.month}월 ${parts.day}일, ${parts.dayPeriod} ${parts.hour}:${parts.minute}`
}

/** 답 글에 붙이는 앵커 id — 링크의 #m-<id> 가 가리킨다 */
export const answerAnchorId = (messageId: string) => `m-${messageId}`

/**
 * 그 대화 · 그 답으로 바로 가는 사내 주소. 로그인해야 열리고, 옴니스 1:1 대화는 방 주인만 연다(app/(main)/chat/[roomId]).
 * 공개(비로그인) 링크는 만들지 않는다 — 답에 사내 정보가 담긴다
 */
export function answerLink(origin: string, roomId: string, messageId: string, basePath = ""): string {
  return `${origin.replace(/\/$/, "")}${basePath}/chat/${encodeURIComponent(roomId)}#${answerAnchorId(messageId)}`
}

/** 주소의 해시가 가리키는 답 글 id. 아니면 null */
export function anchoredMessageId(hash: string): string | null {
  const m = /^#m-([\w-]+)$/.exec(hash)
  return m ? m[1] : null
}
