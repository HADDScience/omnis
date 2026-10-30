"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { Spinner } from "@/components/ui/spinner"
import { roomKeyFromPath } from "@/lib/chat-list"
import { readCache, roomCacheKey, type CachedMessage } from "@/lib/chat-cache"
import { tidyBody } from "@/lib/chat-layout"
import { cn } from "@/lib/utils"
import { useChatUserId } from "./messenger-shell"
import { RoomSkeleton } from "./room-skeleton"

/**
 * 방을 여는 동안(loading.tsx) — 기기에 저장해 둔 최근 글로 바로 그린다. 서버 화면이 오면 이것을 갈아 끼운다
 * (stale-while-revalidate). 저장분이 없으면 스켈레톤. 읽기 전용이다 — 글쓰기 · 카드는 서버 화면에서.
 * 저장 범위와 지우는 때: lib/chat-cache.ts
 */
export function CachedRoomPreview() {
  const pathname = usePathname()
  const userId = useChatUserId()
  const key = roomKeyFromPath(pathname)
  const [cached, setCached] = useState<{ key: string; messages: CachedMessage[] } | null>(null)

  useEffect(() => {
    if (!key || !userId) return
    let alive = true
    void readCache<CachedMessage[]>(userId, roomCacheKey(key)).then((m) => {
      if (alive && m?.length) setCached({ key, messages: m })
    })
    return () => {
      alive = false
    }
  }, [key, userId])

  if (!cached || cached.key !== key) return <RoomSkeleton />
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy aria-label="저장해 둔 대화 — 새로 받는 중" data-cached-preview>
      <div className="flex min-h-[64px] shrink-0 items-center gap-1.5 border-b px-4 py-1.5 text-[14px] text-muted-foreground">
        <Spinner className="size-4" />
        최근 대화를 먼저 보여 주고 새로 받는 중…
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-4 py-4 opacity-80 sm:px-6">
          {cached.messages.slice(-12).map((m) => (
            <div key={m.id} className={cn("flex flex-col gap-0.5", m.mine ? "items-end" : "items-start")}>
              {!m.mine && <span className="px-1 text-[13.5px] text-muted-foreground">{m.author.name}</span>}
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap break-keep rounded-[24px] px-[18px] py-3 text-[17px] leading-[1.6] [overflow-wrap:anywhere]",
                  m.mine ? "rounded-br-lg bg-primary/10" : m.fromOmnis ? "px-0" : "rounded-bl-lg border bg-card",
                  m.fromOmnis && "line-clamp-6",
                )}
              >
                {tidyBody(m.content)}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t px-3 pb-3 pt-2 sm:px-6">
        <div className="mx-auto h-[58px] w-full max-w-[760px] rounded-[29px] border bg-card/60" />
      </div>
    </div>
  )
}
