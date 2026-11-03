"use client"

import { useEffect, useMemo } from "react"
import { useRoomListReload } from "@/components/messenger/messenger-context"
import { trailingDebounce } from "@/lib/trailing-debounce"

/** 연속 수신을 한 번으로 묶는 간격. 대화창 폴링(3초)보다 짧아 글이 뜬 뒤 곧 목록이 따라온다 */
const NUDGE_MS = 1500

/**
 * 열린 방에 새 글이 생겼다(받았거나 보냈다) — 왼쪽 목록의 미리보기 · 순서 · 안 읽은 수를 맞춘다.
 * 방 하나의 글이 늘 때만 부른다. 목록 자체의 30초 폴링은 그대로다(room-list.tsx POLL_MS).
 * 메신저 밖(오른쪽 패널 · 업무 상세)에는 목록이 없어 아무 일도 하지 않는다.
 */
export function useRoomListNudge(): () => void {
  const reload = useRoomListReload()
  const debounced = useMemo(() => trailingDebounce(reload, NUDGE_MS), [reload])
  useEffect(() => () => debounced.flush(), [debounced])
  return debounced.call
}
