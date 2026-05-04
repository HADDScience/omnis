import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { rollback } from "@/lib/omnis-git"

export const runtime = "nodejs"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { cardId } = await params
  const { hash } = (await req.json().catch(() => ({}))) as { hash?: string }
  if (!hash) return NextResponse.json({ error: "hash required" }, { status: 400 })

  const card = await prisma.omnisCard.findUnique({
    where: { id: cardId },
    select: { id: true, title: true },
  })
  if (!card) return NextResponse.json({ error: "not found" }, { status: 404 })

  const restoredContent = rollback(card.id, card.title, hash, session.user.name ?? "unknown")

  await prisma.omnisCard.update({
    where: { id: cardId },
    data: {
      version: { increment: 1 },
      updatedById: session.user.id as string,
    },
  })

  return NextResponse.json({ ok: true, content: restoredContent })
}
