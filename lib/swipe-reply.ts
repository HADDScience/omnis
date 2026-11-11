/**
 * 폰 채팅의 「오른쪽으로 밀어 답장」 판정 — 순수 함수. 화면 쪽은 components/chat/swipe-reply.tsx, 시험은 swipe-reply.test.ts
 *
 * - 화면 왼쪽 끝(약 20px)에서 시작한 손가락은 iOS 사파리의 뒤로 가기 몫이라 잡지 않는다
 * - 처음 10px 안에서 가로(오른쪽)인지 세로인지 정한다. 가로 이동이 세로보다 클 때만 잡고, 아니면 끝까지 놓아 둔다(세로 스크롤)
 * - 움직이지 않고 오래(0.4초) 누르고 있으면 길게 누르기(글자 고르기 · 시스템 메뉴)로 보고 놓아 둔다
 * - 말풍선은 손가락을 따라가되 고무줄처럼 줄어들며 최대 72px 까지만, 48px 을 넘으면 답장 준비(아이콘 · 햅틱) → 손을 떼면 답장
 */

export const SWIPE = {
  /** 이 안쪽(px)에서 시작한 손가락은 잡지 않는다 — iOS 뒤로 가기 가장자리 */
  edge: 20,
  /** 이만큼(px) 움직이면 방향을 정한다 */
  decide: 10,
  /** 말풍선이 끌려가는 최대 거리(px) */
  max: 72,
  /** 이만큼(px, 끌린 거리) 넘으면 답장 준비 */
  trigger: 48,
  /** 방향을 정하기 전에 이만큼(ms) 누르고 있으면 길게 누르기 */
  longPress: 400,
} as const

export interface SwipeStart {
  x: number
  y: number
  /** ms */
  t: number
}

export type SwipeIntent = "pending" | "swipe" | "cancel"

/** 이 자리에서 시작한 손가락을 볼지 — 왼쪽 가장자리는 시스템 뒤로 가기 */
export function swipeStartAllowed(x: number): boolean {
  return x >= SWIPE.edge
}

/** 손가락이 지금 (x, y, t) 일 때 이 몸짓이 무엇인지. 한번 swipe/cancel 이 되면 그대로 둔다(부르는 쪽 몫) */
export function swipeIntent(start: SwipeStart, x: number, y: number, t: number): SwipeIntent {
  const dx = x - start.x
  const dy = y - start.y
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE.decide) {
    return t - start.t >= SWIPE.longPress ? "cancel" : "pending"
  }
  if (t - start.t >= SWIPE.longPress) return "cancel"
  return dx > 0 && Math.abs(dx) > Math.abs(dy) ? "swipe" : "cancel"
}

/**
 * 손가락이 간 거리 → 말풍선이 끌린 거리. 처음엔 거의 그대로 따라가다 점점 무거워져 max 에 다가간다(넘지 않는다).
 * 72·(1 − e^(−dx/72)) — 기울기가 0 에서 1, 끌린 거리 48 은 손가락 약 79px
 */
export function swipeOffset(dx: number): number {
  if (!(dx > 0)) return 0
  return SWIPE.max * (1 - Math.exp(-dx / SWIPE.max))
}

/** 이 끌린 거리면 손을 뗄 때 답장한다 */
export function swipeArmed(offset: number): boolean {
  return offset >= SWIPE.trigger
}

/** 답장 준비 선을 이번에 막 넘었는지 — 넘는 순간 한 번만 햅틱 */
export function swipeCrossed(prevOffset: number, offset: number): boolean {
  return !swipeArmed(prevOffset) && swipeArmed(offset)
}
