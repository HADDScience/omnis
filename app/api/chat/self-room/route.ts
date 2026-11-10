import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError } from "@/lib/api"
import { openSelfRoom } from "@/lib/chat-people"

export const runtime = "nodejs"

/** 「나와의 대화」 를 연다 — 받는 값이 없다. 로그인한 사람의 방만 열린다 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const value = await openSelfRoom({ id: session.user.id })
  return NextResponse.json(value, { status: value.existing ? 200 : 201 })
}
