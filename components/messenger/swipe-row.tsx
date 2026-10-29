"use client"

import { useRef, useState, type ReactNode } from "react"
import { cn } from "@/lib/utils"

export type SwipeSide = "left" | "right"

/** 가로로 이만큼 움직이기 전에는 아무것도 정하지 않는다 — 탭 · 세로 스크롤과 구별 */
const DECIDE_PX = 8
/** 가로가 세로보다 이만큼 우세할 때만 밀기 — 비스듬한 세로 스크롤을 빼앗지 않는다 */
const DOMINANCE = 1.4

/**
 * 목록 한 줄을 옆으로 미는 칸 — 카톡 채팅 목록처럼(작업지시자 3.png · 4.png).
 *   오른쪽→왼쪽: 오른쪽에 숨은 동작(`right`, 예: 삭제 · 나가기)이 드러난다
 *   왼쪽→오른쪽: 왼쪽에 숨은 동작(`left`, 예: 즐겨찾기 · 폴더)이 드러난다
 *
 * 터치 · 마우스 모두 pointer 이벤트로 받는다. 세로 스크롤은 브라우저에 맡기고(`touch-action: pan-y`)
 * 가로가 우세할 때만 줄을 잡는다. 민 뒤의 클릭은 막는다 — 밀다 손을 뗀 자리가 링크라 방이 열렸다.
 * 열린 줄은 한 번에 하나(열림 상태는 부모가 쥔다). 열린 줄을 누르면 닫기만 한다.
 * 키보드는 이 칸을 쓰지 않는다 — 같은 동작이 메뉴(우클릭 · Shift+F10 · 롱프레스)에 있다.
 */
export function SwipeRow({
  open,
  onOpenChange,
  left,
  leftWidth = 0,
  right,
  rightWidth = 0,
  className,
  children,
}: {
  open: SwipeSide | null
  onOpenChange: (side: SwipeSide | null) => void
  left?: ReactNode
  leftWidth?: number
  right?: ReactNode
  rightWidth?: number
  className?: string
  children: ReactNode
}) {
  const start = useRef<{ x: number; y: number; id: number; base: number; mode: "undecided" | "drag" | "scroll" } | null>(null)
  const swallowClick = useRef(false)
  const [drag, setDrag] = useState<number | null>(null)

  const rest = open === "left" ? leftWidth : open === "right" ? -rightWidth : 0
  const offset = drag ?? rest
  const clamp = (v: number) => Math.max(-rightWidth, Math.min(leftWidth, v))

  return (
    <div className={cn("relative overflow-hidden", className)} data-swipe-open={open ?? undefined}>
      {left && (
        <div
          aria-hidden={open !== "left"}
          className="absolute inset-y-0 left-0 flex items-stretch"
          style={{ width: leftWidth, visibility: offset > 0 ? "visible" : "hidden" }}
        >
          {left}
        </div>
      )}
      {right && (
        <div
          aria-hidden={open !== "right"}
          className="absolute inset-y-0 right-0 flex items-stretch"
          style={{ width: rightWidth, visibility: offset < 0 ? "visible" : "hidden" }}
        >
          {right}
        </div>
      )}
      <div
        data-swipe-surface
        className={cn(
          "relative bg-background [touch-action:pan-y]",
          drag === null && "transition-transform duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return
          // 새 손짓 — 손가락으로 민 뒤에는 click 이 오지 않아 버릴 클릭 표시가 남아 있을 수 있다
          swallowClick.current = false
          if (!left && !right) return
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, base: rest, mode: "undecided" }
        }}
        onPointerMove={(e) => {
          const s = start.current
          if (!s || s.id !== e.pointerId) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (s.mode === "undecided") {
            if (Math.abs(dx) < DECIDE_PX && Math.abs(dy) < DECIDE_PX) return
            if (Math.abs(dx) > Math.abs(dy) * DOMINANCE) {
              s.mode = "drag"
              e.currentTarget.setPointerCapture(e.pointerId)
            } else {
              s.mode = "scroll"
              return
            }
          }
          if (s.mode !== "drag") return
          setDrag(clamp(s.base + dx))
        }}
        onPointerUp={(e) => {
          const s = start.current
          start.current = null
          if (!s || s.mode !== "drag") return
          swallowClick.current = true
          const v = clamp(s.base + (e.clientX - s.x))
          setDrag(null)
          if (v > leftWidth / 2 && left) onOpenChange("left")
          else if (v < -rightWidth / 2 && right) onOpenChange("right")
          else onOpenChange(null)
        }}
        onPointerCancel={() => {
          start.current = null
          setDrag(null)
        }}
        onClickCapture={(e) => {
          // 민 끝의 클릭은 버린다(방을 열지 않는다). 마우스는 놓는 순간 click 이 바로 따라와, 여기서 닫으면
          // 방금 연 줄이 곧장 닫혔다 — 민 끝이면 닫지 않는다. 열린 줄을 따로 누르면 방을 열지 않고 닫기만
          if (swallowClick.current) {
            e.preventDefault()
            e.stopPropagation()
            swallowClick.current = false
          } else if (open) {
            e.preventDefault()
            e.stopPropagation()
            onOpenChange(null)
          }
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {children}
      </div>
    </div>
  )
}
