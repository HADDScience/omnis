import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const notifications = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  })

  return NextResponse.json(notifications)
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { id, readAll } = body

  if (readAll) {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    })
    return NextResponse.json({ ok: true })
  }

  if (id) {
    await prisma.notification.update({
      where: { id },
      data: { read: true },
    })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id 또는 readAll 필수" }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  const deleteAll = searchParams.get("all")

  if (deleteAll) {
    await prisma.notification.deleteMany({
      where: { userId: session.user.id },
    })
    return NextResponse.json({ ok: true })
  }

  if (id) {
    await prisma.notification.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id 또는 all 필수" }, { status: 400 })
}
