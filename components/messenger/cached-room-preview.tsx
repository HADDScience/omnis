"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { roomKeyFromPath } from "@/lib/chat-list"
import { LIST_CACHE_KEY, readCache, roomCacheKey, type CachedMessage } from "@/lib/chat-cache"
import { peekHandoff, queuedIsFresh, rememberedRoom, roomFromList, writeHandoff } from "@/lib/chat-entry"
import { tidyBody } from "@/lib/chat-layout"
import { enterSends, isTouchTyping } from "@/lib/enter-to-send"
import type { RoomList, RoomListItem } from "@/lib/chat-rooms"
import { cn } from "@/lib/utils"
import { useChatUserId, useRoomSurfaceReady } from "./messenger-context"
import { RoomHeader } from "./room-header"
import { RoomSkeleton } from "./room-skeleton"

/**
 * 방을 여는 동안(loading.tsx) — 머리 · 입력창은 바로 쓸 수 있게 그리고, 글 칸만 불러오는 중이다(2026-10-30 작업지시자).
 *
 * - 머리: 목록이 받아 둔 방 이름(lib/chat-entry.ts rememberedRoom → 기기 저장 목록)
 * - 글 칸: 기기에 저장해 둔 최근 글이 있으면 그것을 바로, 없으면 스켈레톤(stale-while-revalidate). 저장 범위: lib/chat-cache.ts
 * - 입력창: 진짜 입력칸이다. 쓴 글 · 커서 · 포커스 · 눌러 둔 보내기를 맡겨 두면 방 화면 입력창이 이어받는다(useComposerHandoff)
 *
 * 서버 화면이 오면 이것을 통째로 갈아 끼운다.
 */
export function CachedRoomPreview({ roomKey, overlay = false }: { roomKey?: string; overlay?: boolean } = {}) {
  const pathname = usePathname()
  // 셸이 그릴 때(방을 누른 순간 · 주소가 바뀌기 전)는 누른 방 키를 받는다. loading.tsx 는 주소에서 안다
  const key = roomKey ?? roomKeyFromPath(pathname)
  if (!key) return <RoomSkeleton />
  // 방을 옮기면 새로 시작한다 — 앞 방에 쓰던 글 · 받은 저장분이 다음 방에 남지 않게
  return <RoomEntry key={key} roomKey={key} overlay={overlay} />
}

type ComposerKind = "omnis" | "task" | "company" | "people" | "unknown"

function composerKind(room: RoomListItem | null, roomKey: string): ComposerKind {
  if (roomKey.startsWith("task:")) return "task"
  if (!room) return "unknown"
  if (room.kind === "OMNIS_DM") return "omnis"
  if (room.kind === "COMPANY") return "company"
  return "people"
}

/** 방 화면 입력창과 같은 문구 — 갈아 끼울 때 글자가 바뀌지 않게(omnis-room Composer · chat-panel · thread-composer) */
const PLACEHOLDER: Record<ComposerKind, string> = {
  omnis: "옴니스에게 물어보세요",
  task: "답장 · @ 사람 · # 업무 · 파일은 끌어다 놓기",
  company: "메시지 입력...  / 명령 · @ 사람 · # 업무",
  people: "메시지 입력...  @ 사람",
  unknown: "메시지 입력",
}

/** overlay: 셸이 누른 순간 덮어 그린 것. 아니면 loading.tsx — 그려지면 셸의 덮개를 걷게 알린다 */
function RoomEntry({ roomKey, overlay }: { roomKey: string; overlay: boolean }) {
  const userId = useChatUserId()
  const surfaceReady = useRoomSurfaceReady()
  useLayoutEffect(() => {
    if (!overlay) surfaceReady(roomKey)
  }, [overlay, roomKey, surfaceReady])
  const [room, setRoom] = useState<RoomListItem | null>(() => rememberedRoom(roomKey))
  const [cached, setCached] = useState<CachedMessage[] | null>(null)
  /** 보내기를 눌러 둔 글 — 방 화면이 오면 그쪽이 보낸다. 그때까지 내 말풍선으로 옅게.
   *  셸이 먼저 그린 입장 화면에서 눌렀으면 loading.tsx 로 갈아 끼워진 뒤에도 이어 보인다 */
  const [queued, setQueued] = useState<string | null>(() => {
    const h = peekHandoff(roomKey)
    return h && queuedIsFresh(h, Date.now()) ? h.queued : null
  })

  useEffect(() => {
    if (!userId) return
    let alive = true
    void readCache<CachedMessage[]>(userId, roomCacheKey(roomKey)).then((m) => {
      if (alive && m?.length) setCached(m)
    })
    // 목록을 아직 못 받았으면(새로고침 직후 방 주소로 바로 들어옴) 기기에 저장한 목록에서 이름을 찾는다
    if (!room) {
      void readCache<RoomList>(userId, LIST_CACHE_KEY).then((list) => {
        const hit = roomFromList(list, roomKey)
        if (alive && hit) setRoom(hit)
      })
    }
    return () => {
      alive = false
    }
    // room 은 처음 한 번만 본다 — 찾은 뒤 다시 읽을 까닭이 없다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, userId])

  const kind = composerKind(room, roomKey)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-room-entry>
      <RoomHeader
        title={
          room ? (
            <>
              {room.kind === "TASK" && <span className="mr-0.5 text-muted-foreground">#</span>}
              {room.name}
            </>
          ) : (
            <Skeleton className="h-5 w-44" />
          )
        }
      />
      <div className="relative flex min-h-0 flex-1 flex-col" aria-busy aria-label="대화를 불러오는 중">
        <p className="pointer-events-none absolute inset-x-0 top-2 z-[1] mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1 text-[13px] text-muted-foreground shadow-sm">
          <Spinner className="size-3.5" />
          {cached ? "새 글을 받는 중…" : "대화를 불러오는 중…"}
        </p>
        {cached ? <CachedMessages messages={cached} /> : <MessageSkeleton />}
        {queued && (
          <div className="mx-auto flex w-full max-w-[760px] shrink-0 justify-end px-4 pb-3 sm:px-6" data-queued-message>
            <div className="max-w-[85%] whitespace-pre-wrap break-keep rounded-[24px] rounded-br-lg bg-primary/10 px-[18px] py-3 text-[17px] leading-[1.6] opacity-60 [overflow-wrap:anywhere]">
              {queued}
            </div>
          </div>
        )}
      </div>
      <EntryComposer roomKey={roomKey} kind={kind} queued={queued} onQueue={setQueued} />
    </div>
  )
}

function CachedMessages({ messages }: { messages: CachedMessage[] }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden" data-cached-preview>
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-4 py-4 opacity-80 sm:px-6">
        {messages.slice(-12).map((m) => (
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
  )
}

/** 저장분이 없을 때 — RoomSkeleton 의 글 칸과 같은 모양 */
function MessageSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-6 px-4 py-4 sm:px-6" aria-hidden>
      <Skeleton className="ml-auto h-12 w-1/2 rounded-3xl" />
      <div className="flex gap-3">
        <Skeleton className="size-9 shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2.5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </div>
      <Skeleton className="ml-auto h-12 w-1/3 rounded-3xl" />
    </div>
  )
}

/**
 * 방이 오기 전의 입력창. 모양은 메신저 안 입력줄(알약 하나 · 48px 단추)과 같게 둔다.
 * + 메뉴(첨부 · 명령)는 방 화면에서 연다 — 자리만 그려 갈아 끼울 때 칸이 밀리지 않게 한다.
 */
function EntryComposer({
  roomKey,
  kind,
  queued,
  onQueue,
}: {
  roomKey: string
  kind: ComposerKind
  queued: string | null
  onQueue: (text: string) => void
}) {
  // 셸이 먼저 그린 입장 화면 → loading.tsx 로 갈아 끼울 때 쓰던 글 · 포커스를 잇는다(같은 맡김 칸을 쓴다)
  const [value, setValue] = useState(() => peekHandoff(roomKey)?.text ?? "")
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const h = peekHandoff(roomKey)
    if (!h?.focused) return
    ref.current?.focus({ preventScroll: true })
    ref.current?.setSelectionRange(h.caret, h.caret)
  }, [roomKey])
  /** 갈아 끼우는 중 — 입력칸이 빠지며 나는 blur 를 「포커스를 놓았다」 로 적지 않는다 */
  const leaving = useRef(false)
  useLayoutEffect(
    () => () => {
      leaving.current = true
    },
    [],
  )

  // 내용만큼 늘린다 — 방 화면 입력줄과 같은 상한
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`
  }, [value])

  const omnis = kind === "omnis"
  // 옴니스는 2자 이상(omnis-room send 와 같은 규칙) — 그보다 짧으면 보내기 단추가 꺼진다
  const minLength = omnis ? 2 : 1
  const canSend = queued === null && value.trim().length >= minLength

  function change(next: string, caret: number) {
    setValue(next)
    writeHandoff(roomKey, { text: next, caret })
  }

  function send() {
    const text = value.trim()
    if (!canSend) {
      if (queued !== null) toast("방을 여는 중이에요 — 열리면 먼저 쓴 글부터 보냅니다")
      return
    }
    setValue("")
    writeHandoff(roomKey, { text: "", caret: 0, queued: text, queuedAt: Date.now() })
    onQueue(text)
  }

  return (
    <div className="shrink-0 border-t bg-background px-3 pt-2 pb-3 sm:px-6">
      <div
        className={cn(
          "mx-auto flex w-full max-w-[760px] items-end gap-2.5 rounded-[32px] border bg-card p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] focus-within:border-border-strong",
          omnis && "pl-[22px]",
        )}
      >
        {!omnis && (
          <span aria-hidden className="flex size-[48px] shrink-0 items-center justify-center rounded-full text-muted-foreground/50">
            <HugeiconsIcon icon={PlusSignIcon} size={26} />
          </span>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onSelect={(e) => writeHandoff(roomKey, { caret: e.currentTarget.selectionStart })}
          onFocus={() => writeHandoff(roomKey, { focused: true })}
          onBlur={(e) => {
            // 다음 화면 입력칸으로 포커스를 넘긴 것(relatedTarget 이 입력칸)은 놓은 것이 아니다
            if (!leaving.current && !(e.relatedTarget instanceof HTMLTextAreaElement)) writeHandoff(roomKey, { focused: false })
          }}
          onKeyDown={(e) => {
            // PC 는 Enter 보내기 · Shift+Enter 줄바꿈, 폰은 Enter 가 줄바꿈(lib/enter-to-send.ts)
            if (enterSends(e, isTouchTyping())) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          enterKeyHint="enter"
          aria-label={omnis ? "옴니스에게 보낼 글" : "메시지 입력"}
          placeholder={PLACEHOLDER[kind]}
          data-entry-composer
          className={cn(
            "max-h-48 min-h-[48px] flex-1 resize-none bg-transparent py-[11px] text-[17px] leading-[26px] outline-none placeholder:text-muted-foreground",
            !omnis && "px-1 placeholder:text-[15px]",
          )}
        />
        <Button
          size="icon"
          onClick={send}
          disabled={!canSend}
          aria-label="보내기"
          title="보내기 (Enter)"
          className={cn("touch-target size-[48px] shrink-0 rounded-full", omnis && "ai-rainbow-border")}
        >
          {queued !== null ? <Spinner /> : <HugeiconsIcon icon={ArrowUp01Icon} size={24} aria-hidden className="size-[24px]" />}
        </Button>
      </div>
    </div>
  )
}
