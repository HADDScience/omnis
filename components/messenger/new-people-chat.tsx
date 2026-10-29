"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import { defaultGroupName, PEOPLE_ROOM_NAME_MAX } from "@/lib/chat-people-rules"
import { RoomHeader } from "./room-header"
import { PeoplePicker, type Person } from "./people-picker"
import { useRoomListReload } from "./messenger-shell"

/**
 * 「사람과 대화」 — 구성원을 고른다. 1명이면 1:1(이미 있으면 그 방이 열린다), 2명 이상이면 단톡방.
 * 단톡방 이름은 참여자 이름을 이은 것이 기본이고, 고친 뒤에는 사람을 더 골라도 덮어쓰지 않는다.
 * 빈 방을 만들어도 된다 — 옴니스 「새 대화」 와 달리 상대가 먼저 쓸 수도 있다.
 */
export function NewPeopleChat({ me }: { me: Person }) {
  const router = useRouter()
  const reloadList = useRoomListReload()
  const [selected, setSelected] = useState<Person[]>([])
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const group = selected.length >= 2
  const autoName = defaultGroupName(selected.map((p) => p.name), me.name)
  const roomName = name ?? autoName

  async function start() {
    if (selected.length === 0 || busy) return
    setBusy(true)
    try {
      const res = await fetch(apiUrl("/api/chat/people-rooms"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selected.map((p) => p.id), ...(group ? { name: roomName.trim() || autoName } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? "대화방을 열지 못했어요")
      reloadList()
      router.push(`/chat/${data.roomId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "대화방을 열지 못했어요")
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RoomHeader title="사람과 대화" subtitle="한 명을 고르면 1:1, 여러 명이면 단톡방이에요. 옴니스는 들어오지 않아요" />
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
        <PeoplePicker meId={me.id} selected={selected} onChange={setSelected} autoFocus />
        <div className="shrink-0 space-y-2 border-t px-4 py-3">
          {group && (
            <label className="block">
              <span className="mb-1 block text-[11.5px] text-muted-foreground">단톡방 이름</span>
              <Input
                value={roomName}
                onChange={(e) => setName(e.target.value)}
                maxLength={PEOPLE_ROOM_NAME_MAX}
                aria-label="단톡방 이름"
                className="touch-target h-8 text-[13px]"
              />
            </label>
          )}
          <Button className="touch-target w-full" disabled={selected.length === 0 || busy} onClick={() => void start()}>
            {busy && <Spinner className="size-3.5" />}
            {selected.length === 0
              ? "대화할 사람을 골라 주세요"
              : group
                ? `${selected.length + 1}명 단톡방 만들기`
                : `${selected[0].name}님과 1:1 대화`}
          </Button>
        </div>
      </div>
    </div>
  )
}
