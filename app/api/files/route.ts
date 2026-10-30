import { NextRequest, NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { putObject, objectKeyFor, MAX_UPLOAD_BYTES } from "@/lib/storage"
import { demoStorageBlocked } from "@/lib/demo"
import { visibleFileWhere } from "@/lib/file-access"

/** 최근 파일 — 내가 볼 수 있는 것만(참여자만 보는 방의 파일은 그 방 사람에게만, lib/file-access.ts) */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const files = await prisma.file.findMany({
    where: visibleFileWhere(session.user.id),
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
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const messageId = formData.get("messageId") as string | null
  const taskId = formData.get("taskId") as string | null
  // scope=private — 옴니스 1:1 · 사람끼리 방에 붙일 파일. 붙기 전에는 올린 사람만, 붙은 뒤에는 그 방 참여자만 본다
  const isPrivate = formData.get("scope") === "private"

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
      messageId: isPrivate ? null : messageId || null,
      taskId: isPrivate ? null : taskId || null,
      privateToUserId: isPrivate ? session.user.id : null,
    },
  })

  return NextResponse.json(record, { status: 201 })
}
