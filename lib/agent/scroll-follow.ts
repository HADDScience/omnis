/**
 * 옴니스 방 — 답이 흘러 들어올 때 화면이 따라 내려갈지의 판정(순수 함수).
 * 맨 아래에 붙어 있을 때만 따라간다. 사용자가 위로 올리면(터치 · 휠 · 키보드 모두 scroll 로 나타난다) 멈추고,
 * 직접 아래로 내려 다시 가까워지면 다시 붙는다.
 */

/** 아래에서 이 거리(px) 안이면 맨 아래에 붙어 있는 것으로 본다 — 소수점 스크롤 · 마지막 줄 여백을 흡수한다 */
export const STICK_THRESHOLD = 80

export type ScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number }

/** 맨 아래까지 남은 거리 */
export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.scrollHeight - m.clientHeight - m.scrollTop)
}

/** 맨 아래에 붙어 있는가 */
export function isStuckToBottom(m: ScrollMetrics, threshold = STICK_THRESHOLD): boolean {
  return distanceFromBottom(m) <= threshold
}

/** 앞 글을 붙인 뒤 보던 자리를 지키려면 scrollTop 에 더할 값 */
export function prependScrollDelta(heightBefore: number, heightAfter: number): number {
  return Math.max(0, heightAfter - heightBefore)
}
