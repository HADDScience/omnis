import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { omnisRoomFileBlocked } from "@/lib/agent/room-files"

interface Props {
  params: Promise<{ fileId: string }>
}

export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { fileId } = await params
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, path: true, size: true, mimeType: true },
  })

  // 남의 옴니스 1:1 방 파일은 없는 파일과 같다 — lib/agent/room-files.ts
  if (!file || (await omnisRoomFileBlocked(file.id, session.user.id))) return NextResponse.json({ error: "파일 없음" }, { status: 404 })
  return NextResponse.json(file)
}
