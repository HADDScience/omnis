import type { NextRequest } from "next/server"

import { apiError, parseJson } from "@/lib/api"
import { auth } from "@/lib/auth"
import { advanceSurvey, type SurveyEvent } from "@/lib/ai-survey/service"
import { SurveyTurnSchema } from "@/lib/schemas/ai-survey"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * 한 턴 — 응답 저장 → 다음 질문(또는 요약). 한 줄에 JSON 하나씩 흘린다(NDJSON):
 * 충족도 → 만들어지는 질문 글 → 마지막에 전체 상태. 오류도 한 줄({ t: "error" })로 간다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return apiError(401, "인증 필요")
  const parsed = SurveyTurnSchema.safeParse((await parseJson(req)) ?? {})
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: SurveyEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`))
      try {
        await advanceSurvey(userId, parsed.data, emit)
      } catch (err) {
        console.error("[ai-survey] turn 실패", err)
        emit({ t: "error", status: 500, error: "질문을 준비하지 못했어요. 다시 시도해 주세요" })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } })
}
