import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

type ViewType = "all" | "task" | "dm" | "ai"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const currentUserId = session.user.id as string
  const { searchParams } = new URL(req.url)
  const view = (searchParams.get("view") ?? "all") as ViewType
  const id = searchParams.get("id") ?? undefined
  const userId = searchParams.get("userId") ?? undefined
  const take = Math.min(Number(searchParams.get("take") ?? 100), 200)

  const include = {
    author: { select: { id: true, name: true } },
    task: { select: { id: true, name: true, slug: true } },
    files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    mentions: true,
  }

  let messages: Awaited<ReturnType<typeof prisma.chatMessage.findMany>> = []
  if (view === "all") {
    messages = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take,
      include,
    })
  } else if (view === "task" && id) {
    const mentioned = await prisma.chatMention.findMany({
      where: { type: "TASK", taskId: id },
      select: { messageId: true },
    })
    const ids = mentioned.map((m) => m.messageId)
    messages = await prisma.chatMessage.findMany({
      where: { OR: [{ id: { in: ids } }, { taskId: id }] },
      orderBy: { createdAt: "desc" },
      take,
      include,
    })
  } else if (view === "dm" && userId) {
    // messages between me and userId
    const mentioned = await prisma.chatMention.findMany({
      where: {
        type: "USER",
        OR: [
          { userId, message: { authorId: currentUserId } },
          { userId: currentUserId, message: { authorId: userId } },
        ],
      },
      select: { messageId: true },
    })
    const ids = mentioned.map((m) => m.messageId)
    messages = await prisma.chatMessage.findMany({
      where: { id: { in: ids } },
      orderBy: { createdAt: "desc" },
      take,
      include,
    })
  } else if (view === "ai") {
    const aiUser = await prisma.user.findFirst({
      where: { name: "Omnis AI" },
      select: { id: true },
    })
    if (!aiUser) {
      messages = []
    } else {
      messages = await prisma.chatMessage.findMany({
        where: {
          OR: [
            { authorId: aiUser.id },
            { mentions: { some: { type: "USER", userId: aiUser.id } } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take,
        include,
      })
    }
  } else {
    return NextResponse.json({ error: "invalid view" }, { status: 400 })
  }

  return NextResponse.json(
    messages
      .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
      .reverse()
  )
}
