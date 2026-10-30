import { NextRequest, NextResponse } from "next/server"
import { findVisibleFile } from "@/lib/file-access-server"
import { auth } from "@/lib/auth"

interface Props {
  params: Promise<{ fileId: string }>
}

export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { fileId } = await params
  // 참여자만 보는 방의 파일은 그 방 사람에게만 — 못 보는 파일도 없는 파일과 같은 404
  const file = await findVisibleFile(fileId, session.user.id)
  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 404 })
  return NextResponse.json({ id: file.id, name: file.name, path: file.path, size: file.size, mimeType: file.mimeType })
}
