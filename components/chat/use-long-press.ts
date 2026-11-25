"use client"

// 글 길게 누르기 → 글 메뉴(답장 · 수정 · 삭제) 열기 (2026-11-17).
//
// 폰에는 hover 가 없어 메뉴가 손가락이 우연히 머문 때만 보였다. 길게 누르면 그 글의 메뉴를 붙잡아 연다.
// 오른쪽으로 밀기(답장, lib/swipe-reply.ts)는 0.4초 넘게 멈춰 있으면 놓아 두므로 서로 겹치지 않는다.
// 마우스는 다루지 않는다 — 데스크톱은 hover 로 이미 보인다.
import { useCallback, useEffect, useRef, useState } from "react"

const HOLD_MS = 450
const MOVE_PX = 10

export function useLongPressMenu() {
  const [menuId, setMenuId] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  // 방금 길게 눌러 메뉴를 열었다 — 뒤따르는 시스템 메뉴(contextmenu) · 클릭을 먹는다
  const fired = useRef(false)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
  }, [])

  // 메뉴 밖을 누르면 닫는다
  useEffect(() => {
    if (!menuId) return
    const close = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(`[data-message-actions="${menuId}"]`)) return
      setMenuId(null)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [menuId])

  useEffect(() => clear, [clear])

  const bind = useCallback(
    (id: string, enabled = true) =>
      enabled
        ? {
            onTouchStart: (e: React.TouchEvent) => {
              fired.current = false
              if (e.touches.length !== 1) return clear()
              start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => {
                fired.current = true
                timer.current = null
                setMenuId(id)
                navigator.vibrate?.(10)
              }, HOLD_MS)
            },
            onTouchMove: (e: React.TouchEvent) => {
              const s = start.current
              if (!s) return
              const t = e.touches[0]
              if (Math.abs(t.clientX - s.x) > MOVE_PX || Math.abs(t.clientY - s.y) > MOVE_PX) clear()
            },
            onTouchEnd: (e: React.TouchEvent) => {
              clear()
              // 길게 눌러 연 뒤 손을 떼면 그 아래 링크 · 버튼이 눌리지 않게
              if (fired.current) e.preventDefault()
            },
            onTouchCancel: clear,
            onContextMenu: (e: React.MouseEvent) => {
              if (fired.current) e.preventDefault()
            },
          }
        : {},
    [clear]
  )

  const closeMenu = useCallback(() => setMenuId(null), [])
  return { menuId, closeMenu, bind }
}
