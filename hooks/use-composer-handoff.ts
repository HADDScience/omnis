"use client"

import { useLayoutEffect, useRef } from "react"
import { takeHandoff, type ComposerHandoff } from "@/lib/chat-entry"
import { useRoomSurfaceReady } from "@/components/messenger/messenger-context"

/**
 * 방 화면 입력창이 처음 그릴 때 맡겨 둔 글을 받는다. layout effect 라 loading 화면이 빠지는 같은 커밋에서
 * 포커스를 옮긴다 — 폰 키보드가 내려가기 전에 새 입력칸이 포커스를 잡는다.
 * key 가 없으면(오른쪽 패널 · 업무 상세 등 메신저 밖) 아무것도 하지 않는다.
 */
export function useComposerHandoff(
  key: string | undefined,
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  apply: (h: ComposerHandoff) => void,
) {
  const applyRef = useRef(apply)
  const surfaceReady = useRoomSurfaceReady()
  useLayoutEffect(() => {
    applyRef.current = apply
  })
  useLayoutEffect(() => {
    if (!key) return
    // 방 화면이 그려졌다 — 셸이 덮어 둔 입장 화면을 걷는다(components/messenger/messenger-shell.tsx)
    surfaceReady(key)
    const h = takeHandoff(key)
    if (!h) return
    applyRef.current(h)
    if (h.focused) {
      const el = textareaRef.current
      el?.focus({ preventScroll: true })
      // 글이 들어간 다음 그림에서 커서를 놓는다 — 지금은 아직 이전 값이다
      requestAnimationFrame(() => el?.setSelectionRange(h.caret, h.caret))
    }
  }, [key, textareaRef, surfaceReady])
}
