import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { uiSurveyAnswerSchema } from "@/lib/ui-metrics/rules"
import { surveyTargetFor, uiMetricsServerEnabled } from "@/lib/ui-metrics/server"

export const runtime = "nodejs"

/** 지금 물을 배포. 화면은 하루 한 번만 묻는다(components/layout/ui-metrics.tsx) */
export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!uiMetricsServerEnabled()) return NextResponse.json({ sha: null })
  return NextResponse.json({ sha: await surveyTargetFor(userId) })
}

/** 답이나 닫음을 남긴다. 배포마다 사람당 한 줄 — 먼저 남은 것을 덮지 않는다 */
export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if (!uiMetricsServerEnabled()) return new NextResponse(null, { status: 204 })

  const parsed = uiSurveyAnswerSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "잘못된 요청" }, { status: 400 })

  const { sha, score, comment } = parsed.data
  await prisma.uiSurveyResponse.createMany({
    data: [{ userId, commitSha: sha, score, comment: score === null ? null : comment || null }],
    skipDuplicates: true,
  })
  return new NextResponse(null, { status: 204 })
}
