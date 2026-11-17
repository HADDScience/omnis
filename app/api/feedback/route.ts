import { NextResponse, type NextRequest } from "next/server"
import { apiError, parseJson } from "@/lib/api"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { feedbackReply, feedbackRequest } from "@/lib/feedback"
import { featureForReply, submitFeatureRequest } from "@/lib/feature-requests"

export const runtime = "nodejs"

/**
 * 앱 정보의 「문의·의견 보내기」(components/settings/feedback-dialog.tsx).
 * 옴니스가 받는 기능 요청과 같은 곳에 쌓고 같은 사람에게 알린다(lib/feature-requests.ts · lib/notify-recipients.ts).
 * replyTo(기능 요청 id)가 있으면 완료 알림의 「답장」 — 그 요청을 남긴 사람만 보낼 수 있고 kind 는 보지 않는다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson<{ kind?: unknown; text?: unknown; replyTo?: unknown }>(req)
  const user = await prisma.user.findFirst({ where: { id: session.user.id, isActive: true }, select: { id: true, name: true } })
  if (!user) return apiError(401, "인증 필요")
  let parsed: { title: string; detail: string } | { problem: string }
  let via = "앱 정보 — 문의·의견 보내기"
  if (body?.replyTo != null) {
    const feature = typeof body.replyTo === "string" ? await featureForReply(body.replyTo, user.id) : null
    if (!feature) return apiError(404, "답장할 요청이 없습니다")
    parsed = feedbackReply(feature.title, body.text)
    via = "기능 완료 알림 — 답장"
  } else {
    parsed = feedbackRequest(body?.kind, body?.text)
  }
  if ("problem" in parsed) return apiError(400, parsed.problem)
  const r = await submitFeatureRequest(
    { title: parsed.title, detail: parsed.detail, attempted: "" },
    { userId: user.id, userName: user.name, base: process.env.PUBLIC_URL ?? "", via },
  )
  return NextResponse.json({ id: r.id, merged: r.merged })
}
