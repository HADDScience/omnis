"use client"

import { useEffect, useState, type ComponentProps } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import type { ChatPanel } from "@/components/chat/chat-panel"
import { SELF_ROOM_TITLE, type PeopleRoomView } from "@/lib/chat-people-rules"
import type { RoomListItem } from "@/lib/chat-rooms"
import { dropSnapshot, peekSnapshot, readSnapshot, type RoomSnapshot } from "@/lib/room-snapshot"
import { CompanyRoom } from "./company-room"
import { useRoomListReload } from "./messenger-context"
import { PeopleRoom } from "./people-room"

type Message = ComponentProps<typeof ChatPanel>["initialMessages"][number]

/**
 * 목록에서 누른 방을 서버 페이지 없이 그린다. 저장본이 있으면 그것으로 시작해 새 글 · 고친 글만 받는다.
 * 권한은 첫 읽기에서 서버가 판단한다 — 403 · 404 면 저장본을 지우고 목록으로 돌아간다.
 */
export function ClientRoom({ room, userId }: { room: RoomListItem; userId: string }) {
  const router = useRouter()
  const reloadList = useRoomListReload()
  const [snapshot, setSnapshot] = useState<RoomSnapshot<Message> | null | undefined>(() => peekSnapshot<Message>(userId, room.key) ?? undefined)

  useEffect(() => {
    if (snapshot !== undefined) return
    let alive = true
    void readSnapshot<Message>(userId, room.key).then((s) => {
      if (alive) setSnapshot(s)
    })
    return () => {
      alive = false
    }
  }, [snapshot, userId, room.key])

  // IndexedDB 를 읽는 몇 ms 뿐이다 — 이 사이에 빈 방으로 시작하면 저장본을 쓰지 못한다
  if (snapshot === undefined) return null

  const onRoomGone = () => {
    dropSnapshot(userId, room.key)
    reloadList()
    toast.error("이 방을 볼 수 없습니다")
    router.replace("/chat")
  }
  const messages = snapshot?.messages ?? []
  const resume = messages.length > 0 ? { checkedAt: snapshot!.checkedAt, fromSnapshot: true } : undefined
  const live = { onRoomGone, snapshotKey: room.key }

  if (room.kind === "COMPANY") {
    return <CompanyRoom roomId={room.id} roomName={room.name} currentUserId={userId} initialMessages={messages} resume={resume} muted={room.muted} live={live} />
  }
  // 처음 여는 방은 참여자를 아직 모른다 — 목록이 아는 것으로 그리고 바로 받아 온다
  const view: PeopleRoomView = snapshot?.people ?? {
    id: room.id,
    kind: room.kind === "GROUP" ? "GROUP" : "DM",
    self: room.name === SELF_ROOM_TITLE,
    title: room.name,
    name: room.name,
    members: [],
    activeMembers: [],
  }
  return <PeopleRoom room={view} currentUserId={userId} initialMessages={messages} resume={resume} muted={room.muted} live={live} />
}
