"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import type { ShareState } from "@/lib/omnis-session-share"

type Person = { id: string; name: string }
type RoomChoice = { id: string; name: string; kind: string }
type Tab = "people" | "room" | "handover"

/**
 * 옴니스 세션 공유 · 해제 · 인계 창(2026-11-11, lib/omnis-session-share.ts).
 * 위: 지금 누가 보는지(주인 · 방 공유 · 사람 공유, 각각 해제). 아래: 사람에게 · 방에 공유하기, 다른 사람에게 넘기기.
 * 주인만 연다 — 단추가 주인에게만 보인다. 받은 사람은 보고 이어 물을 수 있고, 비용 · 확인 카드는 그 글을 쓴 사람 몫이다.
 */
export function SessionShareDialog({
  roomId,
  open,
  onOpenChange,
  onChanged,
}: {
  roomId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 공유 상태가 바뀌었다 — 방 화면 · 목록을 다시 읽는다. 인계했으면 handedOver */
  onChanged: (change: { handedOver?: boolean }) => void
}) {
  const [state, setState] = useState<ShareState | null>(null)
  const [members, setMembers] = useState<Person[]>([])
  const [rooms, setRooms] = useState<RoomChoice[]>([])
  const [tab, setTab] = useState<Tab>("people")
  const [picked, setPicked] = useState<string[]>([])
  const [room, setRoom] = useState<string | null>(null)
  const [heir, setHeir] = useState<string | null>(null)
  const [confirmHandover, setConfirmHandover] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(apiUrl(`/api/agent/rooms/${roomId}/share`), { cache: "no-store" }).catch(() => null)
    if (res?.ok) setState((await res.json()) as ShareState)
  }, [roomId])

  useEffect(() => {
    if (!open) return
    setPicked([])
    setRoom(null)
    setHeir(null)
    setConfirmHandover(false)
    void load()
    void fetch(apiUrl("/api/users")).then((r) => (r.ok ? r.json() : [])).then((u: Person[]) => setMembers(u)).catch(() => {})
    void fetch(apiUrl("/api/chat/rooms"))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { company?: RoomChoice[]; groups?: RoomChoice[] } | null) => setRooms([...(d?.company ?? []), ...(d?.groups ?? [])]))
      .catch(() => {})
  }, [open, load])

  async function call(path: string, method: string, body: unknown, done: string) {
    setBusy(true)
    try {
      const res = await fetch(apiUrl(`/api/agent/rooms/${roomId}${path}`), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? `처리하지 못했습니다 (${res.status})`)
      toast.success(done)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "처리하지 못했습니다")
      return false
    } finally {
      setBusy(false)
    }
  }

  const ownerId = state?.owner?.id
  const sharedIds = new Set(state?.people.map((p) => p.id) ?? [])
  const choices = members.filter((m) => m.id !== ownerId)

  async function sharePeople() {
    if (await call("/share", "POST", { userIds: picked }, `${picked.length}명에게 공유했어요`)) {
      setPicked([])
      await load()
      onChanged({})
    }
  }
  async function shareRoom() {
    const target = rooms.find((r) => r.id === room)
    if (room && (await call("/share", "POST", { roomId: room }, `「${target?.name ?? "방"}」에 공유했어요`))) {
      setRoom(null)
      await load()
      onChanged({})
    }
  }
  async function remove(body: { userId: string } | { room: true } | { all: true }, label: string) {
    if (await call("/share", "DELETE", body, label)) {
      await load()
      onChanged({})
    }
  }
  async function handOver() {
    const to = members.find((m) => m.id === heir)
    if (heir && (await call("/handover", "POST", { userId: heir }, `${to?.name ?? "그분"}님에게 넘겼어요`))) {
      onOpenChange(false)
      onChanged({ handedOver: true })
    }
  }

  const tabButton = (t: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      data-share-tab={t}
      onClick={() => setTab(t)}
      className={cn(
        "min-h-11 flex-1 rounded-lg px-3 text-[13px] font-medium transition-colors md:min-h-9",
        tab === t ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-session-share-dialog className="grid max-h-[min(88svh,720px)] w-full max-w-[min(520px,calc(var(--app-vw,100vw)-2rem))] grid-rows-[auto_auto_1fr] gap-4 sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>이 대화 공유</DialogTitle>
          <DialogDescription>받은 사람은 보고 이어서 물을 수 있어요 · 비용과 확인은 글을 쓴 사람 몫이에요</DialogDescription>
        </DialogHeader>

        {/* 지금 보는 사람 */}
        <section data-share-current aria-label="지금 공유된 곳" className="flex flex-col gap-2 rounded-lg border p-3 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">주인</span>
            <span className="font-medium">{state?.owner?.name ?? "…"}</span>
          </div>
          {state?.room && (
            <div className="flex items-center justify-between gap-2" data-share-room={state.room.id}>
              <span className="min-w-0 truncate">방 · {state.room.title}</span>
              <Button size="sm" variant="ghost" className="h-11 shrink-0 md:h-8" disabled={busy} onClick={() => void remove({ room: true }, "방 공유를 풀었어요")}>
                해제
              </Button>
            </div>
          )}
          {state && state.people.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="공유받은 사람">
              {state.people.map((p) => (
                <li key={p.id}>
                  <span className="inline-flex min-h-11 items-center gap-1 rounded-full border pl-3 pr-1 md:min-h-8" data-share-person={p.id}>
                    {p.name}
                    <button
                      type="button"
                      aria-label={`${p.name}님 공유 해제`}
                      disabled={busy}
                      onClick={() => void remove({ userId: p.id }, `${p.name}님 공유를 풀었어요`)}
                      className="touch-hit flex size-7 items-center justify-center rounded-full hover:bg-muted"
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {state && state.memberCount <= 1 ? (
            <p className="text-muted-foreground">아직 나만 보는 대화예요</p>
          ) : (
            <Button size="sm" variant="outline" data-share-remove-all className="h-11 self-end md:h-8" disabled={busy} onClick={() => void remove({ all: true }, "공유를 모두 풀었어요")}>
              모두 해제
            </Button>
          )}
        </section>

        <div className="flex min-h-0 flex-col gap-3">
          <div role="tablist" className="flex gap-1 rounded-xl bg-muted p-1">
            {tabButton("people", "사람에게")}
            {tabButton("room", "방에")}
            {tabButton("handover", "넘기기")}
          </div>

          <div className="min-h-0 overflow-y-auto">
            {tab === "people" && (
              <div className="flex flex-col gap-3">
                <ul className="flex flex-wrap gap-2 md:gap-1.5" aria-label="공유할 사람">
                  {choices.map((u) => {
                    const on = picked.includes(u.id)
                    const already = sharedIds.has(u.id)
                    return (
                      <li key={u.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          aria-label={u.name}
                          disabled={busy || already}
                          data-share-pick={u.id}
                          onClick={() => setPicked((s) => (on ? s.filter((x) => x !== u.id) : [...s, u.id]))}
                          className={cn(
                            "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors disabled:opacity-50 md:min-h-8 md:text-xs",
                            on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                          )}
                        >
                          {on && <HugeiconsIcon icon={Tick02Icon} size={14} aria-hidden />}
                          {u.name}
                          {already && <span className="text-[11px]">· 공유됨</span>}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <Button data-share-people-save className="h-11 self-end md:h-9" disabled={busy || picked.length === 0} onClick={() => void sharePeople()}>
                  {picked.length > 0 ? `${picked.length}명에게 공유` : "공유"}
                </Button>
              </div>
            )}

            {tab === "room" && (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] text-muted-foreground">방 사람 모두가 봐요 · 방에 「공유했어요 · 열기」 한 줄이 남아요 · 방은 하나만</p>
                <ul className="flex flex-col gap-1" aria-label="공유할 방">
                  {rooms.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        aria-pressed={room === r.id}
                        data-share-room-pick={r.id}
                        onClick={() => setRoom(r.id)}
                        className={cn(
                          "flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border px-3 text-left text-sm transition-colors md:min-h-9",
                          room === r.id ? "border-primary bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <span className="min-w-0 truncate">{r.name}</span>
                        <span className="shrink-0 text-[11.5px] text-muted-foreground">{r.kind === "COMPANY" ? "전사방" : r.kind === "DM" ? "1:1" : "단톡방"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <Button data-share-room-save className="h-11 self-end md:h-9" disabled={busy || !room} onClick={() => void shareRoom()}>
                  이 방에 공유
                </Button>
              </div>
            )}

            {tab === "handover" && (
              <div className="flex flex-col gap-3">
                <p className="text-[12.5px] text-muted-foreground">주인을 넘기면 공유 · 해제는 그분이 하고, 나는 공유받은 사람으로 남아요</p>
                <ul className="flex flex-wrap gap-2 md:gap-1.5" aria-label="넘겨받을 사람">
                  {choices.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        aria-pressed={heir === u.id}
                        aria-label={u.name}
                        data-handover-pick={u.id}
                        onClick={() => {
                          setHeir(u.id)
                          setConfirmHandover(false)
                        }}
                        className={cn(
                          "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm transition-colors md:min-h-8 md:text-xs",
                          heir === u.id ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                        )}
                      >
                        {u.name}
                      </button>
                    </li>
                  ))}
                </ul>
                {confirmHandover ? (
                  <div className="flex items-center justify-end gap-2" data-handover-confirm>
                    <span className="mr-auto text-[13px]">{members.find((m) => m.id === heir)?.name}님에게 넘길까요?</span>
                    <Button variant="ghost" className="h-11 md:h-9" onClick={() => setConfirmHandover(false)}>
                      취소
                    </Button>
                    <Button data-handover-save className="h-11 md:h-9" disabled={busy} onClick={() => void handOver()}>
                      넘기기
                    </Button>
                  </div>
                ) : (
                  <Button className="h-11 self-end md:h-9" variant="outline" disabled={!heir} onClick={() => setConfirmHandover(true)}>
                    넘기기…
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
