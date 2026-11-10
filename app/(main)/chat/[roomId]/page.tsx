import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CHAT_PAGE_SIZE } from "@/lib/constants"
import { roomAccess } from "@/lib/chat-rooms"
import { MESSAGE_INCLUDE, shapeMessage } from "@/lib/chat-message-shape"
import { loadAgentRoom } from "@/lib/agent/service"
import { OmnisRoom } from "@/components/messenger/omnis-room"
import { CompanyRoom } from "@/components/messenger/company-room"
import { PeopleRoom } from "@/components/messenger/people-room"
import { loadPeopleRoom } from "@/lib/chat-people"
import { roomMuted } from "@/lib/chat-prefs"

export const dynamic = "force-dynamic"

// 방 하나. 옴니스 1:1 은 옴니스 방, 전사방은 팀 채팅(오른쪽 패널과 같은 ChatPanel), 사람끼리 1:1 · 단톡방은 PeopleRoom 으로 그린다.
// 남의 1:1 방 · 없는 방은 있는지조차 알리지 않고 404 다.
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const { roomId } = await params

  if ((await roomAccess(roomId, userId)) !== "ok") notFound()
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, name: true, kind: true } })
  if (!room) notFound()
  // 머리줄 「알림 끄기 / 켜기」 의 첫 상태 — 방 키는 room:<id>(전사방 · 옴니스 1:1 · 사람 방 모두)
  const muted = await roomMuted(userId, `room:${roomId}`)

  if (room.kind === "OMNIS_DM") {
    // 글 · 확인 카드 · 돌고 있는 실행 — 새로고침해도 카드가 남고, 돌던 답에는 다시 붙는다(3단계 에이전트)
    const loaded = await loadAgentRoom(roomId, userId)
    if (!loaded) notFound()
    // key: 방을 옮기면 입력 중이던 글 · 상태를 새로 시작한다
    return (
      <OmnisRoom
        key={roomId}
        roomId={roomId}
        roomName={loaded.room.name}
        initialMessages={loaded.messages}
        initialCards={loaded.cards}
        initialTools={loaded.tools}
        initialHasMore={loaded.hasMore}
        initialStopped={loaded.stopped}
        activeRun={loaded.activeRun}
        muted={muted}
      />
    )
  }

  if (room.kind === "COMPANY") {
    const { messages, checkedAt } = await recentMessages(roomId)
    return <CompanyRoom key={roomId} roomId={roomId} roomName={room.name} currentUserId={userId} initialMessages={messages} resume={{ checkedAt }} muted={muted} />
  }

  if (room.kind === "DM" || room.kind === "GROUP") {
    // 사람끼리 1:1 · 단톡방(5단계). 참여자만 — roomAccess 를 지났어도 loadPeopleRoom 이 한 번 더 본다
    const people = await loadPeopleRoom(roomId, userId)
    if (!people) notFound()
    const { messages, checkedAt } = await recentMessages(roomId)
    return <PeopleRoom key={roomId} room={people} currentUserId={userId} initialMessages={messages} resume={{ checkedAt }} muted={muted} />
  }

  notFound()
}

/**
 * 첫 화면의 글 한 페이지 — 글 API 와 같은 모양. 읽기 전 시각을 함께 주면 화면이 그 뒤로 고치거나 지운 글만 묻는다.
 * 뒤로 가기는 받아 둔 이 화면을 다시 그리므로, 그 사이의 변경을 놓치지 않으려면 이 시각이 필요하다
 */
async function recentMessages(roomId: string) {
  const checkedAt = new Date().toISOString()
  const recent = await prisma.chatMessage.findMany({
    where: { roomId },
    // API 와 같은 순서 — 시각이 같으면 id. 이 페이지 맨 앞이 「이전 글」 커서가 된다
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CHAT_PAGE_SIZE,
    include: MESSAGE_INCLUDE,
  })
  // 날짜를 글자로 — 폴링이 주는 글과 같은 모양이 된다
  return { checkedAt, messages: JSON.parse(JSON.stringify(recent.reverse().map(shapeMessage))) }
}
