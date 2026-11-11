"use client"

import { useEffect, useRef } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowTurnBackwardIcon } from "@hugeicons/core-free-icons"
import { swipeArmed, swipeCrossed, swipeIntent, swipeOffset, swipeStartAllowed, type SwipeStart } from "@/lib/swipe-reply"

/** 손을 뗀 뒤 제자리로 — 살짝 넘쳤다 돌아오는 스프링 */
const SPRING = "transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1)"

/**
 * 폰 채팅 — 글을 오른쪽으로 밀면 답장(답장 단추와 같고, 입력창에 포커스는 부르는 쪽이 준다).
 * 판정은 lib/swipe-reply.ts. 터치에서만 돈다 — 마우스(PC)는 아무 일이 없다.
 *
 * 놓아 두는 것: 세로 스크롤 · 왼쪽 가장자리(iOS 뒤로 가기) · 길게 누르기 · 이미 고른 글자 · 두 손가락 ·
 * 가로로 밀리는 칸(넓은 표 · 코드) 안에서 시작한 손가락. 링크 · 사진은 탭이면 그대로 열리고, 민 뒤에는 클릭을 한 번 먹는다.
 * 움직임을 줄이기(prefers-reduced-motion)면 말풍선은 움직이지 않고, 준비 선을 넘으면 아이콘만 나타난다.
 */
export function SwipeReply({
  enabled,
  onReply,
  children,
}: {
  enabled: boolean
  onReply: () => void
  children: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const icon = useRef<HTMLSpanElement>(null)
  const latest = useRef(onReply)
  useEffect(() => {
    latest.current = onReply
  }, [onReply])

  useEffect(() => {
    const el = root.current
    if (!enabled || !el) return
    let start: SwipeStart | null = null
    let state: "idle" | "pending" | "swipe" = "idle"
    let offset = 0
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

    const paint = (o: number, animate: boolean) => {
      const b = body.current
      const i = icon.current
      if (b) {
        b.style.transition = animate && !reduced() ? SPRING : "none"
        b.style.transform = o > 0 && !reduced() ? `translate3d(${o}px,0,0)` : ""
      }
      if (i) {
        const armed = swipeArmed(o)
        i.style.transition = animate || reduced() ? "none" : "opacity 120ms, transform 120ms"
        // 끌릴수록 아이콘이 서서히 · 준비 선을 넘으면 또렷하게
        i.style.opacity = reduced() ? (armed ? "1" : "0") : String(Math.min(1, o / 48) * (armed ? 1 : 0.5))
        i.style.transform = `translateY(-50%) scale(${armed ? 1 : 0.8})`
        i.dataset.armed = armed ? "true" : "false"
      }
    }

    const reset = (animate: boolean) => {
      start = null
      state = "idle"
      offset = 0
      paint(0, animate)
      el.removeAttribute("data-swiping")
    }

    // 가로로 밀리는 칸 안에서 시작했나 — 그 칸의 가로 스크롤이 먼저다
    const inHorizontalScroller = (target: EventTarget | null) => {
      for (let n = target as HTMLElement | null; n && n !== el; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 1) {
          const ox = getComputedStyle(n).overflowX
          if (ox === "auto" || ox === "scroll") return true
        }
      }
      return false
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset(false)
      const t = e.touches[0]
      const sel = window.getSelection()
      if (!swipeStartAllowed(t.clientX) || (sel && !sel.isCollapsed) || inHorizontalScroller(e.target)) return
      start = { x: t.clientX, y: t.clientY, t: e.timeStamp }
      state = "pending"
      // 아이콘은 말풍선 줄의 세로 가운데 — 줄의 위 여백(묶음 간격)까지 감싼 이 상자의 가운데가 아니다
      const row = body.current?.firstElementChild as HTMLElement | null
      if (row && icon.current) {
        const r = row.getBoundingClientRect()
        icon.current.style.top = `${r.top - el.getBoundingClientRect().top + r.height / 2}px`
      }
    }

    const onMove = (e: TouchEvent) => {
      if (!start || state === "idle") return
      if (e.touches.length !== 1) return reset(true)
      const t = e.touches[0]
      if (state === "pending") {
        const intent = swipeIntent(start, t.clientX, t.clientY, e.timeStamp)
        if (intent === "pending") return
        // 브라우저가 이미 스크롤을 시작해 막을 수 없으면 놓아 둔다
        if (intent === "cancel" || !e.cancelable) return reset(false)
        state = "swipe"
        el.setAttribute("data-swiping", "")
      }
      e.preventDefault()
      const next = swipeOffset(t.clientX - start.x)
      if (swipeCrossed(offset, next)) navigator.vibrate?.(10)
      offset = next
      paint(offset, false)
    }

    const onEnd = () => {
      if (state === "swipe") {
        const fire = swipeArmed(offset)
        // 민 뒤 손을 떼면 그 자리 링크 · 사진의 클릭이 한 번 올 수 있다 — 먹는다
        const swallow = (ev: Event) => {
          ev.preventDefault()
          ev.stopPropagation()
        }
        el.addEventListener("click", swallow, { capture: true, once: true })
        setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 400)
        reset(true)
        // 입력창 포커스가 사용자 몸짓 안에서 일어나야 폰 키보드가 뜬다 — 손을 뗀 이 자리에서 바로 부른다
        if (fire) latest.current()
        return
      }
      reset(false)
    }

    el.addEventListener("touchstart", onStart, { passive: true })
    el.addEventListener("touchmove", onMove, { passive: false })
    el.addEventListener("touchend", onEnd)
    // 시스템이 손가락을 가져가거나(touchcancel) 길게 눌러 메뉴 · 글자 고르기가 뜨면(contextmenu) 놓아 둔다
    const onCancel = () => reset(true)
    el.addEventListener("touchcancel", onCancel)
    el.addEventListener("contextmenu", onCancel)
    return () => {
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchmove", onMove)
      el.removeEventListener("touchend", onEnd)
      el.removeEventListener("touchcancel", onCancel)
      el.removeEventListener("contextmenu", onCancel)
      reset(false)
    }
  }, [enabled])

  // 꺼져도 같은 상자를 둔다 — 보내는 중 → 보냄처럼 켜짐이 바뀔 때 글 줄이 다시 그려지지 않게
  return (
    <div ref={root} data-swipe-reply className="relative">
      <span
        ref={icon}
        aria-hidden
        data-swipe-reply-icon
        data-armed="false"
        className="pointer-events-none absolute top-1/2 left-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-foreground opacity-0"
      >
        <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={16} />
      </span>
      <div ref={body} data-swipe-reply-body>
        {children}
      </div>
    </div>
  )
}
