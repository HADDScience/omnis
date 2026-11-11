import { NextResponse } from "next/server"

import { apiError } from "@/lib/api"
import { auth } from "@/lib/auth"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { getSurvey, resetSurvey } from "@/lib/ai-survey/service"

export const runtime = "nodejs"

/** 내 설문 — 원문은 본인만 여기서 읽는다(관리자는 결과 화면) */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!surveyAllowed(session.user.id)) return apiError(404, "없는 주소입니다")
  return NextResponse.json(await getSurvey(session.user.id))
}

/** 처음부터 다시 — 내 설문을 지운다 */
export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!surveyAllowed(session.user.id)) return apiError(404, "없는 주소입니다")
  await resetSurvey(session.user.id)
  return NextResponse.json({ ok: true })
}
