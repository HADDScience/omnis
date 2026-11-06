import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { roomAccess } from "@/lib/chat-rooms"
import { displayAuthor, EXTERNAL_SPEAKER_SELECT } from "@/lib/external-speaker"
import { canSeeFile } from "@/lib/file-access"
import { isViewerImage } from "@/lib/photo-viewer"

/** 한 번에 내려보내는 사진 수. 더 있으면 nextBefore(글 시각)로 다시 부른다 */
const PAGE = 60

/**
 * 한 방의 사진 — 사진 뷰어의 「모아보기」(최신순) · 주소의 ?photo= 로 다시 열 때 그 사진의 글 찾기.
 * 방 권한은 채팅 글과 같은 roomAccess, 파일은 canSeeFile. 지운 글 · 시스템 글의 사진은 없다.
 *   GET ?roomId=&before=   → { photos, nextBefore }
 *   GET ?roomId=&fileId=   → { photo } (그 방의 사진이 아니면 404)
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const userId = session.user.id
  const { searchParams } = new URL(req.url)
  const roomId = searchParams.get("roomId")
  if (!roomId) return NextResponse.json({ error: "roomId 필수" }, { status: 400 })
  if ((await roomAccess(roomId, userId)) !== "ok") return NextResponse.json({ error: "이 방을 볼 수 없습니다" }, { status: 403 })
  const fileId = searchParams.get("fileId")
  const before = searchParams.get("before")

  const rows = await prisma.file.findMany({
    where: {
      ...(fileId ? { id: fileId } : {}),
      mimeType: { startsWith: "image/" },
      message: {
        roomId,
        kind: "NORMAL",
        deletedAt: null,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
    },
    orderBy: [{ message: { createdAt: "desc" } }, { createdAt: "asc" }],
    take: fileId ? 1 : PAGE + 1,
    select: {
      id: true, name: true, size: true, mimeType: true, privateToUserId: true, messageId: true,
      message: {
        select: {
          id: true, createdAt: true, content: true,
          author: { select: { id: true, name: true } },
          externalSpeaker: EXTERNAL_SPEAKER_SELECT,
          room: { select: { members: { select: { userId: true } } } },
        },
      },
    },
  })

  const photos = rows
    .filter((f) => f.message && !f.message.content.startsWith("__") && !f.message.content.startsWith("🤖"))
    .filter((f) => isViewerImage(f))
    .filter((f) => canSeeFile({ privateToUserId: f.privateToUserId, messageId: f.messageId, roomMemberIds: f.message!.room.members.map((m) => m.userId) }, userId))
    .map((f) => ({
      fileId: f.id,
      name: f.name,
      messageId: f.message!.id,
      createdAt: f.message!.createdAt.toISOString(),
      author: displayAuthor(f.message!.author, f.message!.externalSpeaker),
      mine: f.message!.author.id === userId && !f.message!.externalSpeaker,
    }))

  if (fileId) {
    return photos[0] ? NextResponse.json({ photo: photos[0] }) : NextResponse.json({ error: "사진 없음" }, { status: 404 })
  }
  // 한 글의 사진이 페이지 경계에서 갈리지 않게, 넘친 글은 통째로 다음 페이지로
  const more = rows.length > PAGE
  const lastMessage = more ? rows[PAGE].message!.createdAt.toISOString() : null
  const page = more ? photos.filter((p) => p.createdAt > lastMessage!) : photos
  return NextResponse.json({ photos: page, nextBefore: more ? lastMessage : null })
}
