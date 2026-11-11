import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError, parseJson } from "@/lib/api"
import { auth } from "@/lib/auth"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { rewindSurvey } from "@/lib/ai-survey/service"

export const runtime = "nodejs"

const Body = z.object({ turnId: z.string().min(1).max(64) })

/** 지난 답 고치기 — 그 질문으로 돌아가고 그 뒤 문답은 지운다 */
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return apiError(401, "인증 필요")
  if (!surveyAllowed(userId)) return apiError(404, "없는 주소입니다")
  const parsed = Body.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, "잘못된 요청입니다")
  const r = await rewindSurvey(userId, parsed.data.turnId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.state)
}
