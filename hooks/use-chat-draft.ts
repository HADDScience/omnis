"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useChatUserId } from "@/components/messenger/messenger-context"
import { DRAFT_EVENT, DRAFT_PREFIX, readDraft, sweepDrafts, writeDraft } from "@/lib/chat-draft"

/**
 * 입력칸 임시저장(lib/chat-draft.ts) — 처음 그릴 때 저장된 글을 되살리고, 글이 바뀔 때마다 저장한다. 비면(보냄) 지운다.
 * 방 키가 없거나(메신저 밖 · 아직 없는 방) 메신저 밖이라 사람을 모르면 아무것도 하지 않는다.
 *
 * 되살리기는 입력칸이 비어 있을 때만 — loading 입력창에서 이어받은 글(useComposerHandoff)이 먼저다.
 * 그래서 이 훅은 useComposerHandoff 뒤에 부른다(같은 커밋의 layout effect 가 순서대로 돈다).
 */
export function useChatDraft(roomKey: string | undefined, value: string, setValue: (update: (current: string) => string) => void) {
  const userId = useChatUserId()
  /** 이 방 키로 되살리기를 마쳤는가 — 그 전의 빈 값으로 저장된 초안을 지우지 않게 */
  const restoredFor = useRef<string | null>(null)
  /** 되살린 글이 아직 그려지지 않았다 — 이번 그림의 값(되살리기 전)은 저장하지 않는다 */
  const skipNext = useRef(false)
  const setRef = useRef(setValue)
  useLayoutEffect(() => {
    setRef.current = setValue
  })

  useLayoutEffect(() => {
    if (!userId || !roomKey) return
    const saved = readDraft(userId, roomKey)
    if (saved) {
      skipNext.current = true
      setRef.current((current) => (current.trim() ? current : saved))
    }
    restoredFor.current = `${userId}|${roomKey}`
  }, [userId, roomKey])

  useEffect(() => {
    if (!userId || !roomKey) return
    // 되살린 값이 그려지기 전(첫 그림의 빈 값)은 건너뛴다
    if (restoredFor.current !== `${userId}|${roomKey}`) return
    if (skipNext.current) {
      skipNext.current = false
      return
    }
    writeDraft(userId, roomKey, value)
  }, [userId, roomKey, value])
}

/**
 * 방 목록용 — 이 사람의 초안 전부(방 키 → 글). 같은 탭에서 고치면 DRAFT_EVENT, 다른 탭이면 storage 이벤트로 다시 읽는다.
 * 처음 그림(서버)에는 비어 있고 붙은 뒤에 읽는다 — 서버 그림과 어긋나지 않게.
 */
export function useChatDrafts(userId: string): Map<string, string> {
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map())
  useEffect(() => {
    if (!userId) return
    const reload = () => setDrafts(sweepDrafts(userId))
    reload()
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key.startsWith(DRAFT_PREFIX)) reload()
    }
    window.addEventListener(DRAFT_EVENT, reload)
    window.addEventListener("storage", onStorage)
    return () => {
      window.removeEventListener(DRAFT_EVENT, reload)
      window.removeEventListener("storage", onStorage)
    }
  }, [userId])
  return drafts
}
