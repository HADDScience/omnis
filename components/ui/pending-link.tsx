"use client"

import { useLinkStatus } from "next/link"

/**
 * 링크 안에 두면 이동이 진행 중인 동안 표시를 남긴다.
 *
 * 스켈레톤은 "다음 화면이 온다"를 말하지만, 사람 눈이 있는 곳은 **방금 누른 그 자리**다.
 * 거기서 아무 일도 안 일어나면 눌렸는지부터 의심한다. 그래서 두 겹으로 둔다 —
 * 여기서 "받았다", 새 화면에서 "이런 게 온다".
 *
 * 화면 전체에 도는 막대와 달리 **어느 것을 눌렀는지**가 남는다.
 *
 * 그리는 것은 숨은 표식뿐이고, 실제 모양은 부모가 정한다. 부모에
 * `has-data-[pending]:…` 을 붙이면 된다. 위에 덮는 요소를 두지 않는 이유는,
 * 자리잡기(relative)를 요구하고 `[&>span:last-child]` 같은 기존 선택자와 부딪히기
 * 때문이다.
 *
 *   <Link className="has-data-[pending]:bg-muted">
 *     라벨
 *     <LinkPendingMark />
 *   </Link>
 */
export function LinkPendingMark() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return <span data-pending hidden aria-hidden />
}
