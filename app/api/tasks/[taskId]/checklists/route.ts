import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

interface Props {
  params: Promise<{ taskId: string }>
}

export async function POST(req: NextRequest, { params }: Props) {
  const { taskId } = await params
  const body = await req.json()
  const { name, ownerId } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: "name 필수" }, { status: 400 })
  }

  const checklist = await prisma.checklist.create({
    data: {
      name: name.trim(),
      taskId,
      ownerId: ownerId || null,
    },
  })

  return NextResponse.json(checklist, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, done, memo } = body

  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (done !== undefined) data.done = done
  if (memo !== undefined) data.memo = memo
  if (body.name !== undefined) data.name = body.name.trim()

  const checklist = await prisma.checklist.update({
    where: { id },
    data,
  })

  return NextResponse.json(checklist)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  await prisma.checklist.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
