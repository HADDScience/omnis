import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { readChatFeed, type FeedView } from "@/lib/chat-feed"

// 알맹이는 lib/chat-feed 에 있다 — MCP(list_chat)도 같은 함수를 부른다.

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const result = await readChatFeed({
    currentUserId: session.user.id as string,
    view: (searchParams.get("view") ?? "all") as FeedView,
    id: searchParams.get("id") ?? undefined,
    userId: searchParams.get("userId") ?? undefined,
    take: Number(searchParams.get("take") ?? 100),
  })
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json(
    result.messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() }))
  )
}
