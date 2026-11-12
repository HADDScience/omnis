"use client"

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { buttonVariants } from "@/components/ui/button"
import { roomKeyFromPath, unreadElsewhere, unreadLabel } from "@/lib/chat-list"
import { cn } from "@/lib/utils"
import { usePanelNav, useStartRoomEntry } from "./messenger-context"

type UnreadRoom = { key: string; unread: number }

const NO_ROOMS: UnreadRoom[] = []
const UnreadRooms = createContext<UnreadRoom[]>(NO_ROOMS)
const PublishUnreadRooms = createContext<(rooms: UnreadRoom[]) => void>(() => {})

const sameUnread = (a: UnreadRoom[], b: UnreadRoom[]) =>
  a.length === b.length && a.every((r, i) => r.key === b[i].key && r.unread === b[i].unread)

/**
 * 목록(RoomList)이 받은 방별 안 읽은 수를 대화 머리로 넘긴다. 목록은 폰에서 방을 여는 동안에도 셸 안에 살아 폴링한다.
 * 상태를 셸 아래로 빼서 수가 바뀌어도 뒤로 단추만 다시 그린다 — 대화 칸은 다시 그리지 않는다.
 */
export function UnreadElsewhereProvider({ children }: { children: ReactNode }) {
  const [rooms, setRooms] = useState(NO_ROOMS)
  const publish = useCallback((next: UnreadRoom[]) => setRooms((prev) => (sameUnread(prev, next) ? prev : next)), [])
  return (
    <PublishUnreadRooms.Provider value={publish}>
      <UnreadRooms.Provider value={rooms}>{children}</UnreadRooms.Provider>
    </PublishUnreadRooms.Provider>
  )
}

export function usePublishUnreadRooms(rooms: UnreadRoom[]) {
  const publish = useContext(PublishUnreadRooms)
  useEffect(() => publish(rooms), [publish, rooms])
}

/**
 * 대화 머리의 뒤로 단추(폰). 지금 보는 방을 뺀 안 읽은 글 수를 옆에 쓴다. 없으면 단추만.
 * 이름표는 수와 상관없이 그대로 두고 수는 설명으로 읽어 준다. 누르는 자리는 44px 밑으로 내려가지 않는다.
 */
export function RoomBackLink({ capsule, roomKey }: { capsule: boolean; roomKey?: string }) {
  const startEntry = useStartRoomEntry()
  const panel = usePanelNav()
  const pathname = usePathname()
  const rooms = useContext(UnreadRooms)
  const count = unreadElsewhere(rooms, roomKey ?? (panel ? panel.activeKey : roomKeyFromPath(pathname)))
  const describedBy = useId()
  const className = cn(
    buttonVariants({ variant: "ghost", size: "icon-sm" }),
    // 오른쪽 패널은 PC 폭이어도 목록과 방을 하나씩 보여 준다 — 폰처럼 늘 보인다
    "touch-target h-11 w-auto min-w-11 shrink-0",
    !panel && "md:hidden",
    count > 0 && "gap-0 pr-3 pl-1",
    capsule && "glass rounded-full",
  )
  const body = (
    <>
      <HugeiconsIcon icon={ArrowLeft01Icon} size={26} aria-hidden className="size-[26px]" />
      {count > 0 && (
        <>
          <span aria-hidden data-back-unread className="text-[14px] font-medium tabular-nums">
            {unreadLabel(count)}
          </span>
          <span id={describedBy} className="sr-only">
            안 읽은 글 {count}개
          </span>
        </>
      )}
    </>
  )
  if (panel) {
    return (
      <button type="button" onClick={panel.back} aria-label="채팅방 목록으로" aria-describedby={count > 0 ? describedBy : undefined} className={className}>
        {body}
      </button>
    )
  }
  return (
    <Link
      href="/chat"
      // 목록(/chat)에서 방을 막 누른 입장 화면이면 주소가 그대로라 이동만으로는 화면이 안 바뀐다 — 덮개를 걷는다
      onClick={() => startEntry(null)}
      aria-label="채팅방 목록으로"
      aria-describedby={count > 0 ? describedBy : undefined}
      className={className}
    >
      {body}
    </Link>
  )
}
