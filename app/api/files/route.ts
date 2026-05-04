import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

export async function GET() {
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

  const bytes = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)

  // 파일명 생성 (timestamp + 원본명)
  const timestamp = Date.now()
  const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : ""
  const fileName = `${timestamp}${ext}`
  const uploadDir = path.join(process.cwd(), "public", "uploads")

  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, fileName), buffer)

  const record = await prisma.file.create({
    data: {
      name: file.name,
      path: `/uploads/${fileName}`,
      size: file.size,
      mimeType: file.type || "application/octet-stream",
      messageId: messageId || null,
      taskId: taskId || null,
    },
  })

  return NextResponse.json(record, { status: 201 })
}
