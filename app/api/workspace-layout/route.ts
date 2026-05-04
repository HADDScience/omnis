import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { workspaceLayout: true },
  })

  return NextResponse.json({ layout: user?.workspaceLayout ?? null })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { layout } = await req.json()

  await prisma.user.update({
    where: { id: session.user.id },
    data: { workspaceLayout: layout },
  })

  return NextResponse.json({ ok: true })
}
