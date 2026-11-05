"use client"

import { useCallback, useState, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { BASE_PATH } from "@/lib/base-path"
import { roomKeyFromPath } from "@/lib/chat-list"
import { RoomList } from "./room-list"
import { NewChatMenu } from "./new-chat-menu"
import { CachedRoomPreview } from "./cached-room-preview"
import { ChatUser, OpenClientRoom, RoomListReload, RoomSurfaceReady, StartRoomEntry } from "./messenger-context"
import { ClientRoom } from "./client-room"
import { rememberedRoom } from "@/lib/chat-entry"
import { isFastRoom } from "@/lib/room-snapshot"
import type { RoomListItem } from "@/lib/chat-rooms"

export { useChatUserId, useRoomListReload, useRoomSurfaceReady, useStartRoomEntry } from "./messenger-context"

/**
 * 메신저 셸 — 왼쪽 방 목록 + 가운데 대화. 카톡 PC 처럼 목록은 사이드바가 아니라 이 화면 안의 왼쪽 칸이다.
 *
 * 폰(< md)에서는 둘 중 하나만 보인다: /chat 은 목록, 방 주소(/chat/…)는 대화. 대화 머리의 ← 가 목록으로 돌아간다.
 * 두 모양은 CSS 로만 가른다 — 경로는 서버도 알아서 첫 화면이 어긋나지 않는다.
 *
 * 높이는 MainWithChat 스크롤 칸 안에서 h-full 이다. 그 칸이 nav 높이(--nav-offset-*)를 이미 비워 두므로 여기서 다시 빼지 않는다.
 *
 * 2026-10-30 작업지시자 「채팅방이 지금의 2배, 채팅 안에서도 스케일이 더 커져야」 — 폰 Gemini 앱 수준으로 목록 줄 · 본문 · 입력창을 키웠다.
 * 키운 크기는 이 셸 안에서만 먹는다: 루트에 `data-messenger` 를 달고, 메신저 밖에서도 쓰는 부품(ChatPanel · MessageList · MessageInput ·
 * TaskThread · OmnisAnswerBody · AuthorAvatar …)은 `in-data-[messenger]:…` 변형으로 크기를 더한다. 오른쪽 패널(MainWithChat 의 형제)·
 * 업무 상세·온보딩 시연은 이 셸 밖이라 그대로다. CSS zoom 은 쓰지 않는다(스크롤 · 좌표 계산이 어긋난다).
 *
 * 폰의 제목 줄(「채팅」)은 목록(RoomList)이 그린다(2026-11-05). PC 는 제목줄을 두지 않는다(2026-10-29 작업지시자). 다만 PC 의 떠 있는 nav 는 화면 위 가운데에 겹쳐 뜨므로
 * (--nav-offset-top 이 PC 에서 0) 그 높이만큼은 위를 비운다 — 안 비우면 nav 가 목록 칩 줄과 대화 머리를 덮는다.
 */
export function MessengerShell({ children, userId }: { children: ReactNode; userId: string }) {
  const pathname = usePathname()
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  // 방을 누른 순간부터 그 방 화면이 그려질 때까지 — 그 방의 입장 화면(CachedRoomPreview)을 셸이 덮어 그린다(2026-10-30).
  // loading.tsx 는 링크를 미리 받아 둔(prefetch) 뒤에야 바로 뜬다. 화면 밖에 있다 막 스크롤해 들어온 줄 · 미리 받은 것이
  // 낡은 줄은 서버가 답할 때까지 아무것도 바뀌지 않았고, 주소가 먼저 바뀐 뒤 방 칸이 한동안 비기도 했다.
  // 그래서 주소가 아니라 그 방 화면(또는 loading 화면)이 실제로 그려졌다는 알림(RoomSurfaceReady)을 받고 걷는다.
  // 다른 곳으로 옮기면(뒤로 가기 · 다른 링크) 바로 걷는다
  const [entering, setEntering] = useState<string | null>(null)
  // 목록에서 누른 전사 · 사람 방은 서버 페이지 없이 그린다. 주소는 pushState 로 바꾼다(주소를 직접 열거나 새로고침하면 서버 페이지다).
  // 뒤로 · 앞으로 가서 다른 방 주소가 되면 그 방을 그린다 — 라우터의 화면은 pushState 전 그대로라 children 에 맡길 수 없다
  const [clientRoom, setClientRoom] = useState<RoomListItem | null>(null)
  const [seenPath, setSeenPath] = useState(pathname)
  if (seenPath !== pathname) {
    // 그리는 중에 맞춘다(effect 로 미루면 떠난 방의 입장 화면이 한 번 더 그려진다)
    setSeenPath(pathname)
    if (entering && roomKeyFromPath(pathname) !== entering) setEntering(null)
    if (!clientRoom || `/chat/${clientRoom.id}` !== pathname) {
      const key = roomKeyFromPath(pathname)
      const known = key ? rememberedRoom(key) : null
      setClientRoom(known && isFastRoom(known) ? known : null)
    }
  }
  const openClientRoom = useCallback((room: RoomListItem) => {
    setEntering(null)
    setClientRoom(room)
    window.history.pushState(null, "", `${BASE_PATH}/chat/${room.id}`)
  }, [])
  const startEntry = useCallback(
    (key: string | null) => setEntering(key === roomKeyFromPath(pathname) ? null : key),
    [pathname],
  )
  const surfaceReady = useCallback((key: string) => setEntering((e) => (e === key ? null : e)), [])
  const atList = pathname === "/chat" && !entering && !clientRoom

  return (
    <ChatUser.Provider value={userId}>
    <RoomListReload.Provider value={reload}>
    <StartRoomEntry.Provider value={startEntry}>
    <RoomSurfaceReady.Provider value={surfaceReady}>
    <OpenClientRoom.Provider value={openClientRoom}>
      <div data-messenger data-chat-at-list={atList ? "" : undefined} className="flex h-full min-h-0 flex-col md:pt-12">
        <div className="flex min-h-0 flex-1">
          <aside
            aria-label="채팅방 목록"
            className={cn(
              "relative min-h-0 w-full flex-col border-r md:flex md:w-[340px] md:shrink-0 lg:w-[360px]",
              atList ? "flex" : "hidden",
            )}
          >
            <RoomList version={version} userId={userId} />
            {/* PC 의 새 대화 — 폰은 제목 줄 아이콘이 같은 메뉴를 연다. 모양은 nav 의 리퀴드 글래스(.glass) */}
            <NewChatMenu
              data-new-chat-fab
              side="top"
              iconSize={26}
              className="glass absolute! right-4 bottom-4 z-[var(--z-dock)] flex size-[60px] items-center justify-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.94] data-[popup-open]:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-md:hidden"
            />
          </aside>
          <section className={cn("relative min-h-0 min-w-0 flex-1 flex-col md:flex", atList ? "hidden" : "flex")}>
            {clientRoom ? <ClientRoom key={clientRoom.key} room={clientRoom} userId={userId} /> : children}
            {/* 방 화면은 그 아래에서 그대로 받아 그린다 — 다 그려지면 입력창이 글을 이어받고 이 덮개를 걷는다 */}
            {entering && (
              <div className="absolute inset-0 z-[1] flex flex-col bg-background">
                <CachedRoomPreview roomKey={entering} overlay />
              </div>
            )}
          </section>
        </div>
      </div>
    </OpenClientRoom.Provider>
    </RoomSurfaceReady.Provider>
    </StartRoomEntry.Provider>
    </RoomListReload.Provider>
    </ChatUser.Provider>
  )
}
