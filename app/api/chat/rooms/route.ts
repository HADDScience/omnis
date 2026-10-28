import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listRooms } from "@/lib/chat-rooms"

export const runtime = "nodejs"

/**
 * 메신저 왼쪽 목록 — 내 옴니스 1:1 방 · 전사방 · 업무방(최근 글 순) · 단톡방(5단계).
 * 예전에는 모든 방을 마지막 글과 함께 돌려줬다. 이제 방에 참여자가 있어 남의 1:1 방이 섞이면 안 된다.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  return NextResponse.json(await listRooms(session.user.id))
}
