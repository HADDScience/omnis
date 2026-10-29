"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowExpand01Icon, PencilEdit02Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { Skeleton } from "@/components/ui/skeleton"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { OmnisRoom } from "@/components/messenger/omnis-room"
import type { AgentRoomState } from "@/lib/agent/service"
import type { RoomList } from "@/lib/chat-rooms"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"

type Room = { id: string; name: string; lastAt: string }

const lastRoomKey = (userId: string) => `omnis.panel.omnis.${userId}`

/**
 * 오른쪽 패널의 「옴니스」 탭 — 내 옴니스 1:1 방을 이어 쓰거나 새로 연다. 방 화면과 같은 OmnisRoom 을 끼운다
 * (에이전트 런타임 · 확인 카드 · 다시 붙기를 따로 만들지 않는다). 「크게 보기」 는 /chat/<방> 으로 간다.
 * 예전 「Omnis AI」 탭(Gemini 한 번 묻기, OmnisAsk)은 되살리지 않았다 — 쓰기를 확인 없이 열던 경로다.
 */
export function PanelOmnis({ userId }: { userId: string }) {
  const [rooms, setRooms] = useState<Room[] | null>(null)
  /** null = 새 대화 */
  const [roomId, setRoomId] = useState<string | null | undefined>(undefined)
  const [state, setState] = useState<AgentRoomState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 패널에서 새 대화를 시작해 생긴 방 — 화면은 그대로 두고(스트림이 끊기지 않게) 「크게 보기」 만 그 방으로 */
  const [created, setCreated] = useState<string | null>(null)

  const loadRooms = useCallback(async () => {
    const res = await fetch(apiUrl("/api/chat/rooms")).catch(() => null)
    if (!res?.ok) {
      setError("대화 목록을 불러오지 못했어요")
      setRooms([])
      return [] as Room[]
    }
    const data = (await res.json()) as RoomList
    const list = data.omnis.map((r) => ({ id: r.id, name: r.name, lastAt: r.lastAt }))
    setRooms(list)
    return list
  }, [])

  // 처음 — 마지막으로 패널에서 본 방, 없으면 가장 최근 방, 그것도 없으면 새 대화
  useEffect(() => {
    void loadRooms().then((list) => {
      let saved: string | null = null
      try {
        saved = window.localStorage.getItem(lastRoomKey(userId))
      } catch {
        // 저장소를 못 읽으면 가장 최근 방
      }
      setRoomId(list.find((r) => r.id === saved)?.id ?? list[0]?.id ?? null)
    })
  }, [loadRooms, userId])

  const pick = useCallback(
    (id: string | null) => {
      setRoomId(id)
      setCreated(null)
      try {
        if (id) window.localStorage.setItem(lastRoomKey(userId), id)
      } catch {
        // 이번 세션에만 영향이 있다
      }
    },
    [userId],
  )

  // 고른 방의 글 · 카드 · 돌고 있는 실행
  useEffect(() => {
    if (!roomId) {
      setState(null)
      return
    }
    let alive = true
    setState(null)
    setError(null)
    fetch(apiUrl(`/api/agent/rooms/${roomId}`), { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return
        if (!res.ok) throw new Error()
        setState((await res.json()) as AgentRoomState)
      })
      .catch(() => alive && setError("대화를 불러오지 못했어요"))
    return () => {
      alive = false
    }
  }, [roomId])

  const current = rooms?.find((r) => r.id === roomId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2.5 pb-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="touch-target flex h-8 min-w-0 flex-1 items-center gap-1 rounded-full border bg-background/60 px-3 text-left text-[12px] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="옴니스 대화 고르기"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{roomId === null ? "새 대화" : (current?.name ?? "불러오는 중…")}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={12} aria-hidden className="shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 w-64">
            <DropdownMenuItem className="touch-target gap-2" onClick={() => pick(null)}>
              <HugeiconsIcon icon={PencilEdit02Icon} size={14} aria-hidden className="text-primary" />
              새 대화
            </DropdownMenuItem>
            {rooms && rooms.length > 0 && <DropdownMenuLabel>최근 대화</DropdownMenuLabel>}
            {rooms?.slice(0, 20).map((r) => (
              <DropdownMenuItem key={r.id} className={cn("touch-target", r.id === roomId && "font-semibold")} onClick={() => pick(r.id)}>
                <span className="truncate">{r.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={() => pick(null)}
          aria-label="옴니스와 새 대화"
          title="새 대화"
          className="touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={15} aria-hidden />
        </button>
        <Link
          href={(roomId ?? created) ? `/chat/${roomId ?? created}` : "/chat/new"}
          aria-label="크게 보기 — 채팅 화면에서 열기"
          title="크게 보기"
          className="touch-target flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <HugeiconsIcon icon={ArrowExpand01Icon} size={15} aria-hidden />
        </Link>
      </div>

      {error ? (
        <p role="alert" className="mx-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
          {error}
        </p>
      ) : roomId === undefined || (roomId && !state) ? (
        <div className="flex flex-col gap-3 p-4" aria-hidden>
          <Skeleton className="ml-auto h-8 w-2/3 rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
        </div>
      ) : (
        <OmnisRoom
          key={roomId ?? "new"}
          roomId={roomId}
          roomName={state?.room.name}
          initialMessages={state?.messages ?? []}
          initialCards={state?.cards ?? []}
          initialTools={state?.tools ?? {}}
          initialHasMore={state?.hasMore ?? false}
          activeRun={state?.activeRun ?? null}
          embedded={{
            onRoomCreated: (id) => {
              setCreated(id)
              try {
                window.localStorage.setItem(lastRoomKey(userId), id)
              } catch {
                // 이번 세션에만 영향이 있다
              }
              void loadRooms()
            },
          }}
        />
      )}
    </div>
  )
}
