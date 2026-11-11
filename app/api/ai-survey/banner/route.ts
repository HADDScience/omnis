import { NextResponse } from "next/server"

import { apiError } from "@/lib/api"
import { auth } from "@/lib/auth"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { surveyEntryFor } from "@/lib/ai-survey/service"

export const runtime = "nodejs"

/** 맨 위 안내 띠를 띄울지 — 설문이 열린 계정이고 한 번도 제출하지 않았을 때만 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if (!surveyAllowed(session.user.id)) return apiError(404, "없는 주소입니다")
  const { banner } = await surveyEntryFor(session.user.id)
  return NextResponse.json({ show: banner }, { headers: { "Cache-Control": "no-store" } })
}
