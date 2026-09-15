"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"

/**
 * Keep keyboard shortcuts and focus inside the introduction, including during automatic transitions.
 *
 * `suspended` — 안내 중에 다른 창(MCP 등록)을 띄울 때. 포커스·키 가두기를 풀고 화면을 숨기되
 * 안내 상태(장면·시계)는 그대로 둔다. 가두기가 켜진 채면 위에 뜬 창의 입력칸으로 포커스가 가지 않고
 * Escape 가 안내를 끝내 버린다.
 */
export function TourSurface({
  children,
  onEscape,
  className = "",
  label,
  suspended = false,
}: {
  children: ReactNode
  onEscape: () => void
  className?: string
  label: string
  suspended?: boolean
}) {
  const surface = useRef<HTMLDivElement>(null)
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  }, [onEscape])
  useEffect(() => {
    if (suspended) return
    const previous = document.activeElement as HTMLElement | null
    const node = surface.current!
    const focus = () =>
      node.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
    focus()
    const key = (event: KeyboardEvent) => {
      event.stopImmediatePropagation()
      if (event.key === "Escape") {
        event.preventDefault()
        escape.current()
        return
      }
      if (event.key !== "Tab") return
      const buttons = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], [tabindex="0"]'
        ),
      ]
      const index = buttons.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) {
        event.preventDefault()
        buttons.at(-1)?.focus()
      } else if (
        !event.shiftKey &&
        (index === -1 || index === buttons.length - 1)
      ) {
        event.preventDefault()
        buttons[0]?.focus()
      }
    }
    const contain = (event: FocusEvent) => {
      if (!node.contains(event.target as Node)) focus()
    }
    document.addEventListener("keydown", key, true)
    document.addEventListener("focusin", contain)
    return () => {
      document.removeEventListener("keydown", key, true)
      document.removeEventListener("focusin", contain)
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [suspended])
  return createPortal(
    <div
      ref={surface}
      hidden={suspended}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`omnis-tour-surface ${className}`}
    >
      {children}
    </div>,
    document.body
  )
}
