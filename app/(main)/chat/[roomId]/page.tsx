import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"
import { roomAccess } from "@/lib/chat-rooms"
import { loadOmnisRoom } from "@/lib/omnis-room"
import { OmnisRoom } from "@/components/messenger/omnis-room"
import { CompanyRoom } from "@/components/messenger/company-room"

export const dynamic = "force-dynamic"

// 방 하나. 옴니스 1:1 은 옴니스 방, 전사방은 팀 채팅(오른쪽 패널과 같은 ChatPanel)으로 그린다.
// 남의 1:1 방 · 없는 방은 있는지조차 알리지 않고 404 다.
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) notFound()
  const { roomId } = await params

  if ((await roomAccess(roomId, userId)) !== "ok") notFound()
  const room = await prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, name: true, kind: true } })
  if (!room) notFound()

  if (room.kind === "OMNIS_DM") {
    const loaded = await loadOmnisRoom(roomId, userId)
    if (!loaded) notFound()
    // key: 방을 옮기면 입력 중이던 글 · 상태를 새로 시작한다
    return <OmnisRoom key={roomId} roomId={roomId} roomName={loaded.room.name} initialMessages={loaded.messages} />
  }

  if (room.kind === "COMPANY") {
    const recent = await prisma.chatMessage.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
      take: CHAT_PAGE_SIZE,
      include: {
        author: { select: { id: true, name: true } },
        task: { select: { id: true, name: true, slug: true } },
        files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
        replyTo: { select: { id: true, content: true, deletedAt: true, author: { select: { name: true } } } },
      },
    })
    // 메시지 API(GET /api/chat/messages)의 shape 와 같게 — 지운 글은 자리만, 답장은 인용 한 줄
    const messages = recent.reverse().map((m) => ({
      ...m,
      content: m.deletedAt ? CHAT_DELETED_TEXT : m.content,
      files: m.deletedAt ? [] : m.files,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      deletedAt: m.deletedAt?.toISOString() ?? null,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            authorName: m.replyTo.author.name,
            content: m.replyTo.deletedAt ? CHAT_DELETED_TEXT : m.replyTo.content.slice(0, 80),
          }
        : null,
    }))
    return <CompanyRoom key={roomId} roomId={roomId} roomName={room.name} currentUserId={userId} initialMessages={messages} />
  }

  // 단톡방은 5단계에서 연다
  notFound()
}
