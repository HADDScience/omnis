import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadTaskRoom } from "@/lib/chat-task-room"

// 업무방 하나 — 오른쪽 패널의 채팅이 방을 열 때 읽는다(메신저 업무방 페이지와 같은 loadTaskRoom)
export async function GET(_req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { taskId } = await params
  const room = await loadTaskRoom(taskId, session.user.id)
  if (!room) return NextResponse.json({ error: "업무를 찾을 수 없습니다" }, { status: 404 })
  return NextResponse.json(room, { headers: { "Cache-Control": "no-store" } })
}
