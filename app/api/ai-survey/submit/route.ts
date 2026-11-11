import { NextResponse } from "next/server"

import { apiError, writeActivity } from "@/lib/api"
import { auth } from "@/lib/auth"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { submitSurvey } from "@/lib/ai-survey/service"

export const runtime = "nodejs"

/** 요약을 확인하고 제출한다 */
export async function POST() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return apiError(401, "인증 필요")
  if (!surveyAllowed(userId)) return apiError(404, "없는 주소입니다")
  const r = await submitSurvey(userId)
  if (!r.ok) return apiError(r.status, r.error)
  await writeActivity({ userId, action: "ai_survey.submitted", entity: "AiSurvey", title: "AI 활용 설문 제출" })
  return NextResponse.json(r.state)
}
