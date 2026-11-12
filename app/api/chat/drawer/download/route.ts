import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { drawerGate, resolveDownload } from "@/lib/room-drawer-server"
import { DOWNLOAD_MAX_FILES } from "@/lib/room-drawer"

/**
 * 「N개 받기」 — 고른 파일의 받을 주소. 바이트는 이 라우트를 지나지 않는다(Vercel 응답 4.5MB 한도):
 * R2 의 큰 파일은 짧은 서명 주소, NAS 의 파일(4MB 이하)은 /api/files/:id/raw 를 브라우저가 하나씩 받아 그 자리에서 zip 으로 묶는다.
 *   POST { roomId, fileIds } → { files: [{ fileId, name, size, mimeType, createdAt, authorName, url, local }], skipped }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked
  const body = (await req.json().catch(() => null)) as { roomId?: unknown; fileIds?: unknown } | null
  const roomId = typeof body?.roomId === "string" ? body.roomId : null
  const fileIds = Array.isArray(body?.fileIds) ? body.fileIds.filter((x): x is string => typeof x === "string") : null
  if (!roomId || !fileIds || fileIds.length === 0) return NextResponse.json({ error: "roomId · fileIds 필수" }, { status: 400 })
  if (fileIds.length > DOWNLOAD_MAX_FILES) return NextResponse.json({ error: `한 번에 ${DOWNLOAD_MAX_FILES}개까지 받을 수 있어요` }, { status: 400 })
  const gate = await drawerGate(roomId, session.user.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  return NextResponse.json(await resolveDownload(roomId, session.user.id, fileIds), { headers: { "Cache-Control": "private, no-store" } })
}
