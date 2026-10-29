import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { listRooms } from "@/lib/chat-rooms"
import { createOmnisRoom } from "@/lib/omnis-room"
import { CreateOmnisRoomSchema } from "@/lib/schemas/chat-room"

export const runtime = "nodejs"
// 옴니스 답은 도구를 여러 번 부른다 — 실측 5~20초. 오른쪽 패널 질문과 같은 상한
export const maxDuration = 60

/**
 * 메신저 왼쪽 목록 — 내 옴니스 1:1 방 · 전사방 · 업무방(최근 글 순) · 단톡방(5단계) + 내 폴더 · 안 읽은 수 · 즐겨찾기.
 * 예전에는 모든 방을 마지막 글과 함께 돌려줬다. 이제 방에 참여자가 있어 남의 1:1 방이 섞이면 안 된다.
 * `?q=` 는 방 이름 · 업무 이름 · 슬러그 · 마지막 글 미리보기로 거른다(업무방은 최근 30개 밖까지 찾는다).
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const q = req.nextUrl.searchParams.get("q")?.slice(0, 100) ?? ""
  return NextResponse.json(await listRooms(session.user.id, { q }))
}

/**
 * 새 대화 — 첫 글과 함께 옴니스 1:1 방을 만들고 바로 묻는다.
 * 답을 못 받아도 방과 질문은 남는다(201 + error). 화면은 그 방으로 가서 「다시 묻기」 를 띄운다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!process.env.GEMINI_API_KEY) return apiError(503, "AI 기능이 비활성화되어 있습니다")

  const body = await parseJson(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const parsed = CreateOmnisRoomSchema.safeParse(body)
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const { room, result } = await createOmnisRoom(session.user.id, parsed.data.content)
  return NextResponse.json(
    result.ok
      ? { room, messages: [result.question, result.answer] }
      : { room, messages: result.question ? [result.question] : [], error: result.error },
    { status: 201 },
  )
}
