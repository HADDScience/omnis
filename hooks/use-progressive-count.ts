"use client"

import { startTransition, useCallback, useEffect, useState } from "react"
import { nextRevealCount } from "@/lib/progressive-count"

/**
 * 긴 목록을 앞에서부터 나눠 그린다 — 처음엔 `initial` 개, 끝자리(sentinel)가 스크롤 칸 안으로 다가오면 `step` 개씩 더.
 *
 * 왜: 뒤로 가기는 앞 화면을 처음부터 다시 그린다. 업무 687건을 한 번에 그리면 폰(CPU 4배 감속)에서 그 렌더가 0.5~1.5초
 * 메인 스레드를 막았고, 라우터는 다 그릴 때까지 상세 화면을 그대로 두어 「멈춘 듯하다가 늦게 바뀌는」 화면이 됐다(2026-11-12 측정).
 * 앞부분만 그리면 화면은 바로 바뀌고, 나머지는 사람이 내릴 때 그린다. 더 그리는 일은 전환(startTransition)이라 입력을 막지 않는다.
 *
 * 끝자리는 가장 가까운 스크롤 칸을 기준으로 본다 — 칸 밖에서 잘린 자리는 화면 기준 관찰로는 보이지 않는다.
 */
export function useProgressiveCount(total: number, initial: number, step: number) {
  const [count, setCount] = useState(initial)
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null)
  const more = count < total

  useEffect(() => {
    if (!more || !sentinel) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) startTransition(() => setCount((c) => nextRevealCount(c, total, step)))
      },
      // 칸 끝에서 화면 한 장쯤 먼저 — 내리는 손이 빈자리를 보지 않게
      { root: scrollParent(sentinel), rootMargin: "0px 0px 800px 0px" }
    )
    io.observe(sentinel)
    return () => io.disconnect()
    // count 가 바뀔 때마다 새로 본다 — 더 그린 뒤에도 끝자리가 여전히 가까우면 첫 관찰이 바로 이어 그린다
  }, [count, more, sentinel, total, step])

  const showAll = useCallback(() => startTransition(() => setCount(total)), [total])

  return { count: Math.min(count, total), more, rest: Math.max(0, total - count), observe: setSentinel, showAll }
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === "auto" || overflowY === "scroll") return p
  }
  return null
}
