"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowExpand01Icon } from "@hugeicons/core-free-icons"
import { Skeleton } from "@/components/ui/skeleton"
import { OmnisRoom } from "@/components/messenger/omnis-room"
import { RoomHeader } from "@/components/messenger/room-header"
import type { AgentRoomState } from "@/lib/agent/service"
import { apiUrl } from "@/lib/base-path"

/**
 * 오른쪽 패널 채팅(PanelMessenger)의 옴니스 방 하나 — 목록에서 고른 옴니스 대화, 또는 새 대화(roomId null).
 * 방 화면과 같은 OmnisRoom 을 끼운다(에이전트 런타임 · 확인 카드 · 다시 붙기를 따로 만들지 않는다). 「크게 보기」 는 /chat/<방> 으로 간다.
 * 예전에는 패널의 「옴니스」 탭이 이 대화를 드롭다운으로 골랐다(2026-10-29). 이제 옴니스 대화도 목록의 방 하나다(2026-11-11).
 */
export function PanelOmnis({
  roomId,
  startKey = null,
  onStarted,
  onRoomCreated,
  onGone,
}: {
  /** null = 새 대화 */
  roomId: string | null
  /** 「Omnis 와 함께 업무 시작하기」 의 일회용 키 — 오면 새 대화로 그 글을 보낸다 */
  startKey?: string | null
  onStarted?: (key: string) => void
  /** 새 대화의 첫 글로 방이 생겼다 — 화면은 그대로 두고(스트림이 끊기지 않게) 목록 · 기억만 맞춘다 */
  onRoomCreated?: (roomId: string) => void
  /** 볼 수 없는 방(지워졌거나 공유가 풀렸다) */
  onGone?: () => void
}) {
  const [state, setState] = useState<AgentRoomState | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 패널에서 새 대화를 시작해 생긴 방 — 「크게 보기」 만 그 방으로 */
  const [created, setCreated] = useState<string | null>(null)

  // 고른 방의 글 · 카드 · 돌고 있는 실행
  useEffect(() => {
    if (!roomId) return
    let alive = true
    fetch(apiUrl(`/api/agent/rooms/${roomId}`), { cache: "no-store" })
      .then(async (res) => {
        if (!alive) return
        if (res.status === 403 || res.status === 404) {
          onGone?.()
          return
        }
        if (!res.ok) throw new Error()
        setState((await res.json()) as AgentRoomState)
      })
      .catch(() => alive && setError("대화를 불러오지 못했어요"))
    return () => {
      alive = false
    }
    // onGone 은 방을 다시 읽을 까닭이 아니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  const isNew = roomId === null && !created
  const target = roomId ?? created
  const origin = state?.room.origin ?? null
  const title = isNew ? "새 대화" : (state?.room.name ?? "옴니스")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader
        title={title}
        subtitle={isNew ? "옴니스와 1:1 · 첫 글을 보내면 대화방이 생깁니다" : origin ? `공유됨 · ${origin.title}` : "옴니스와 1:1"}
        roomKey={target ? `room:${target}` : undefined}
        actions={
          <Link
            href={target ? `/chat/${target}` : "/chat/new"}
            aria-label="크게 보기 — 채팅 화면에서 열기"
            title="크게 보기"
            data-panel-expand
            className="touch-target flex size-[46px] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <HugeiconsIcon icon={ArrowExpand01Icon} size={20} aria-hidden />
          </Link>
        }
      />

      {error ? (
        <p role="alert" className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : roomId && !state ? (
        <div className="flex flex-col gap-3 p-4" aria-hidden>
          <Skeleton className="ml-auto h-8 w-2/3 rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="ml-auto h-8 w-1/2 rounded-2xl" />
        </div>
      ) : (
        <OmnisRoom
          key={startKey ? `start:${startKey}` : (roomId ?? "new")}
          roomId={startKey ? null : roomId}
          autoStartKey={startKey ?? undefined}
          onAutoStarted={onStarted}
          roomName={state?.room.name}
          initialMessages={state?.messages ?? []}
          initialCards={state?.cards ?? []}
          initialTools={state?.tools ?? {}}
          initialHasMore={state?.hasMore ?? false}
          initialStopped={state?.stopped ?? {}}
          activeRun={state?.activeRun ?? null}
          origin={state?.room.origin ?? null}
          owner={state?.room.owner ?? null}
          isOwner={state?.room.isOwner ?? true}
          memberCount={state?.room.memberCount ?? 1}
          busyBy={state?.busyBy ?? null}
          embedded={{
            onRoomCreated: (id) => {
              setCreated(id)
              onRoomCreated?.(id)
            },
          }}
        />
      )}
    </div>
  )
}
