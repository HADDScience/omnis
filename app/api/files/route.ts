import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { putObject, objectKeyFor, MAX_UPLOAD_BYTES } from "@/lib/storage"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const files = await prisma.file.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, name: true, path: true, mimeType: true, size: true },
  })
  return NextResponse.json(files)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const messageId = formData.get("messageId") as string | null
  const taskId = formData.get("taskId") as string | null

  if (!file) {
    return NextResponse.json({ error: "파일 필수" }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const limitMb = Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)
    return NextResponse.json({ error: `파일이 너무 큽니다. ${limitMb}MB 이하만 올릴 수 있습니다.` }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const id = randomUUID()

  // NAS에 먼저 올리고, 성공한 뒤에만 DB에 기록한다.
  // 순서가 반대면 업로드 실패 시 실물 없는 레코드가 남는다.
  await putObject(objectKeyFor(id, file.name), buffer, file.type || "application/octet-stream")

  const record = await prisma.file.create({
    data: {
      id,
      name: file.name,
      path: `/api/files/${id}/raw`,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      messageId: messageId || null,
      taskId: taskId || null,
    },
  })

  return NextResponse.json(record, { status: 201 })
}
