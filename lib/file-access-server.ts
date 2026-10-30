// 첨부 파일 접근 — DB 를 읽는 쪽. 규칙은 lib/file-access.ts canSeeFile
import { prisma } from "@/lib/db"
import { canSeeFile } from "@/lib/file-access"

const ACCESS_SELECT = {
  id: true, name: true, path: true, size: true, mimeType: true, privateToUserId: true, messageId: true,
  message: { select: { room: { select: { members: { select: { userId: true } } } } } },
} as const

/** 이 사람이 볼 수 있으면 파일, 아니면 null — 없는 파일과 못 보는 파일을 가르지 않는다(있다는 것도 새지 않게) */
export async function findVisibleFile(fileId: string, userId: string) {
  const f = await prisma.file.findUnique({ where: { id: fileId }, select: ACCESS_SELECT })
  if (!f) return null
  const ok = canSeeFile(
    { privateToUserId: f.privateToUserId, messageId: f.messageId, roomMemberIds: f.message ? f.message.room.members.map((m) => m.userId) : null },
    userId,
  )
  if (!ok) return null
  return { id: f.id, name: f.name, path: f.path, size: f.size, mimeType: f.mimeType, isPrivate: f.privateToUserId !== null }
}
