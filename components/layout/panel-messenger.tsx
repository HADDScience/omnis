"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { RoomList } from "@/components/messenger/room-list"
import { NewChatMenu } from "@/components/messenger/new-chat-menu"
import { ClientRoom } from "@/components/messenger/client-room"
import { TaskRoom } from "@/components/messenger/task-room"
import { UnreadElsewhereProvider } from "@/components/messenger/room-back-link"
import { ChatUser, PanelNav, RoomListReload, type PanelNavValue } from "@/components/messenger/messenger-context"
import { rememberedRoom } from "@/lib/chat-entry"
import type { RoomList as RoomListData, RoomListItem } from "@/lib/chat-rooms"
import type { TaskRoomData } from "@/lib/chat-task-room"
import type { PanelRoomRef } from "@/lib/panel-chat-rules"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { PanelOmnis } from "./panel-omnis"
import { useRightPanel } from "./right-panel-context"

/** 새 옴니스 대화 — 첫 글을 보내야 방이 생긴다 */
const NEW_OMNIS = "omnis:new"

type View = { kind: "list" } | { kind: "room"; room: RoomListItem; viewKey: string } | { kind: "new"; viewKey: string; startKey: string | null }

/** 기억한 방(PanelRoomRef)을 목록 줄 모양으로 — 목록이 아는 최신 줄이 있으면 그것 */
function toListItem(ref: PanelRoomRef): RoomListItem {
  return (
    rememberedRoom(ref.key) ?? {
      id: ref.id,
      key: ref.key,
      kind: ref.kind,
      name: ref.name,
      lastAt: "",
      preview: null,
      unread: 0,
      favorite: false,
      muted: ref.muted ?? false,
    }
  )
}

const toRef = (r: RoomListItem): PanelRoomRef => ({ id: r.id, key: r.key, kind: r.kind, name: r.name, muted: r.muted })

/**
 * PC 오른쪽 패널의 채팅 — 폰 채팅 탭을 그대로 떼어 붙였다: 방 목록 → 방 → 대화(2026-11-11 작업지시자).
 * 목록(RoomList) · 방 화면(ClientRoom · TaskRoom · OmnisRoom) · 뒤로 단추를 메신저와 같은 부품으로 그린다. 다른 점은 둘:
 *   - 주소를 바꾸지 않는다. 방을 옮기는 것은 PanelNav 가 맡는다(본문은 보던 업무 · IP 화면 그대로)
 *   - 옴니스 대화도 목록의 방 하나다(예전 「옴니스」 탭의 드롭다운은 없앴다). 새 옴니스 대화는 「새 대화」 메뉴에서
 * 폰처럼 방에 들어가 있어도 목록은 살려 둔다 — 안 읽은 수(뒤로 단추 옆)와 목록 순서가 계속 맞는다.
 * 마지막으로 연 방은 기억해 두었다가 패널을 다시 열면 그 방으로 연다(useRightPanel().lastRoom).
 */
export function PanelMessenger({
  userId,
  startKey,
  onStarted,
  openRequest,
  searchRequest,
}: {
  userId: string
  /** 「Omnis 와 함께 업무 시작하기」 — 새 옴니스 대화로 이 키의 글을 보낸다 */
  startKey: string | null
  onStarted: (key: string) => void
  /** 밖에서 방을 열라고 했다(?taskId= 링크) — seq 가 바뀔 때마다 */
  openRequest: { seq: number; room: PanelRoomRef } | null
  /** ⌘⇧F — 전사방을 열고 그 검색 줄로 */
  searchRequest: number
}) {
  const router = useRouter()
  const { lastRoom, setLastRoom } = useRightPanel()
  const [version, setVersion] = useState(0)
  const reload = useCallback(() => setVersion((v) => v + 1), [])

  // 처음 — 기억한 방이 있으면 그 방, 없으면 목록. 업무 시작 · 링크 요청이 있으면 그쪽이 이긴다(아래 effect)
  const [view, setView] = useState<View>(() => (lastRoom ? roomView(toListItem(lastRoom)) : { kind: "list" }))
  /** 새 대화에서 방이 생겼으면 그 방 키 — 목록은 그 줄을 켜되 화면은 다시 그리지 않는다(답 스트림이 끊긴다) */
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const open = useCallback(
    (room: RoomListItem) => {
      setView(roomView(room))
      setCreatedKey(null)
      setLastRoom(toRef(room))
    },
    [setLastRoom],
  )
  const back = useCallback(() => {
    setView({ kind: "list" })
    setCreatedKey(null)
  }, [])
  const gone = useCallback(() => {
    toast.error("이 방을 볼 수 없습니다")
    setLastRoom(null)
    reload()
    back()
  }, [setLastRoom, reload, back])
  const openNewOmnis = useCallback((key: string | null = null) => {
    setView({ kind: "new", viewKey: key ? `start:${key}` : `${NEW_OMNIS}:${Date.now()}`, startKey: key })
    setCreatedKey(null)
  }, [])

  // 업무에서 「Omnis 와 함께 시작하기」 를 넘겨받았다 — 보던 방 대신 새 대화로
  useEffect(() => {
    if (startKey) openNewOmnis(startKey)
  }, [startKey, openNewOmnis])

  // ?taskId= 링크 — 그 업무방으로
  const seenRequest = useRef<number | null>(null)
  useEffect(() => {
    if (!openRequest || seenRequest.current === openRequest.seq) return
    seenRequest.current = openRequest.seq
    open(toListItem(openRequest.room))
  }, [openRequest, open])

  // ⌘⇧F — 전사방을 열고 검색 줄을 연다. 목록을 아직 못 받았으면 한 번 받아 전사방을 찾는다
  const [searchSeq, setSearchSeq] = useState(0)
  useEffect(() => {
    if (!searchRequest) return
    let alive = true
    const companyIn = (list: RoomListData | null) => list?.company[0] ?? null
    void (async () => {
      let company: RoomListItem | null = null
      if (view.kind === "room" && view.room.kind === "COMPANY") company = view.room
      if (!company) {
        const res = await fetch(apiUrl("/api/chat/rooms")).catch(() => null)
        company = res?.ok ? companyIn((await res.json()) as RoomListData) : null
      }
      if (!alive || !company) return
      if (!(view.kind === "room" && view.room.key === company.key)) open(company)
      setSearchSeq((n) => n + 1)
    })()
    return () => {
      alive = false
    }
    // 요청이 올 때만 — 보는 방이 바뀌었다고 다시 찾지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequest])

  const activeKey = view.kind === "room" ? view.room.key : view.kind === "new" ? createdKey : null
  const nav = useMemo<PanelNavValue>(() => ({ activeKey, open, back }), [activeKey, open, back])

  return (
    <ChatUser.Provider value={userId}>
      <RoomListReload.Provider value={reload}>
        <PanelNav.Provider value={nav}>
          <UnreadElsewhereProvider>
            {/* data-messenger — 폰 채팅 탭과 같은 크기(목록 줄 · 본문 · 입력창). 패널 폭(400px)이 폰 폭과 비슷하다 */}
            <div data-messenger data-panel-messenger={view.kind === "list" ? "list" : "room"} className="relative flex min-h-0 flex-1 flex-col">
              <section aria-label="채팅방 목록" className={cn("relative min-h-0 flex-1 flex-col", view.kind === "list" ? "flex" : "hidden")}>
                <RoomList version={version} userId={userId} />
                <NewChatMenu
                  data-new-chat-fab
                  side="top"
                  iconSize={24}
                  onOmnis={() => openNewOmnis(null)}
                  // 사람 고르기는 본문 화면에서 — 채팅 화면으로 가면 패널은 닫힌다
                  onPeople={() => router.push("/chat/new/people")}
                  className="glass absolute! right-3 bottom-3 z-[var(--z-dock)] flex size-[52px] items-center justify-center rounded-full text-foreground transition-transform duration-150 active:scale-[0.94] data-[popup-open]:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </section>
              {view.kind !== "list" && (
                <section aria-label="대화" className="relative flex min-h-0 min-w-0 flex-1 flex-col">
                  {view.kind === "new" ? (
                    <PanelOmnis
                      key={view.viewKey}
                      roomId={null}
                      startKey={view.startKey}
                      onStarted={onStarted}
                      onRoomCreated={(id) => {
                        setCreatedKey(`room:${id}`)
                        setLastRoom({ id, key: `room:${id}`, kind: "OMNIS_DM", name: "옴니스" })
                        reload()
                      }}
                    />
                  ) : view.room.kind === "OMNIS_DM" ? (
                    <PanelOmnis key={view.viewKey} roomId={view.room.id} onGone={gone} />
                  ) : view.room.kind === "TASK" ? (
                    <PanelTaskRoom key={view.viewKey} taskId={view.room.id} userId={userId} onGone={gone} />
                  ) : (
                    <ClientRoom key={view.viewKey} room={view.room} userId={userId} searchRequest={searchSeq} />
                  )}
                </section>
              )}
            </div>
          </UnreadElsewhereProvider>
        </PanelNav.Provider>
      </RoomListReload.Provider>
    </ChatUser.Provider>
  )
}

function roomView(room: RoomListItem): View {
  return { kind: "room", room, viewKey: room.key }
}

/** 업무방을 패널에서 — 메신저 업무방 페이지와 같은 글(loadTaskRoom)을 API 로 받는다. 남이 쓴 글은 몇 초마다 다시 받는다 */
const TASK_POLL_MS = 10_000

function PanelTaskRoom({ taskId, userId, onGone }: { taskId: string; userId: string; onGone: () => void }) {
  const [room, setRoom] = useState<TaskRoomData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const goneRef = useRef(onGone)
  useEffect(() => {
    goneRef.current = onGone
  }, [onGone])

  const load = useCallback(async () => {
    const res = await fetch(apiUrl(`/api/chat/task-rooms/${encodeURIComponent(taskId)}`), { cache: "no-store" }).catch(() => null)
    if (res?.status === 404) {
      goneRef.current()
      return
    }
    if (!res?.ok) {
      setError((e) => e ?? "업무방을 불러오지 못했어요")
      return
    }
    setRoom((await res.json()) as TaskRoomData)
    setError(null)
  }, [taskId])

  useEffect(() => {
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, TASK_POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  if (!room) {
    return error ? (
      <p role="alert" className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
        {error}
      </p>
    ) : (
      <div className="flex flex-col gap-3 p-4" aria-hidden>
        <Skeleton className="h-10 w-2/3 rounded-xl" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
      </div>
    )
  }
  return <TaskRoom room={room} currentUserId={userId} onChanged={() => void load()} />
}
