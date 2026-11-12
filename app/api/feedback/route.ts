import { NextResponse, type NextRequest } from "next/server"
import { apiError, parseJson } from "@/lib/api"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { feedbackRequest } from "@/lib/feedback"
import { submitFeatureRequest } from "@/lib/feature-requests"

export const runtime = "nodejs"

/**
 * 앱 정보의 「문의·의견 보내기」(components/settings/feedback-dialog.tsx).
 * 옴니스가 받는 기능 요청과 같은 곳에 쌓고 같은 사람에게 알린다(lib/feature-requests.ts · lib/notify-recipients.ts).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = await parseJson<{ kind?: unknown; text?: unknown }>(req)
  const parsed = feedbackRequest(body?.kind, body?.text)
  if ("problem" in parsed) return apiError(400, parsed.problem)
  const user = await prisma.user.findFirst({ where: { id: session.user.id, isActive: true }, select: { id: true, name: true } })
  if (!user) return apiError(401, "인증 필요")
  const r = await submitFeatureRequest(
    { title: parsed.title, detail: parsed.detail, attempted: "" },
    { userId: user.id, userName: user.name, base: process.env.PUBLIC_URL ?? "", via: "앱 정보 — 문의·의견 보내기" },
  )
  return NextResponse.json({ id: r.id, merged: r.merged })
}
