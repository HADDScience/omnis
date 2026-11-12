import { NextResponse } from "next/server"

import { apiError } from "@/lib/api"
import { auth } from "@/lib/auth"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { canSeeSurveyResults, loadSurveyResults } from "@/lib/ai-survey/results"

export const runtime = "nodejs"

/** 설문 결과 — 관리자만, 합계만. 이름 · 사람별 원문은 내려보내지 않는다(lib/ai-survey/results.ts) */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!surveyAllowed(session.user.id)) return apiError(404, "없는 주소입니다")
  if (!canSeeSurveyResults((session.user as { role?: string }).role)) return apiError(403, "관리자만 볼 수 있습니다")
  return NextResponse.json(await loadSurveyResults())
}
