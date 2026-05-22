import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
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
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, path: true, size: true, mimeType: true },
  })

  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 404 })
  return NextResponse.json(file)
}
