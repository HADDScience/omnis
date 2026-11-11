import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError } from "@/lib/api"
import { PASSWORD_ENTITY, passwordNoticeFor } from "@/lib/password-state"

/**
 * 임시 비밀번호 안내의 「나중에」 — 7일 동안 안내를 숨긴다(판정: lib/password-notice.ts).
 * 대상은 언제나 세션의 계정이다. 바꿔야 할 비밀번호가 없으면 아무것도 남기지 않는다.
 */
export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const userId = session.user.id
  const state = await passwordNoticeFor(userId)
  if (!state.pending) return NextResponse.json({ pending: false, snoozedUntil: null })
  if (state.snoozedUntil) return NextResponse.json({ pending: true, snoozedUntil: state.snoozedUntil.toISOString() })
  await prisma.activityLog.create({
    data: { userId, entity: PASSWORD_ENTITY, entityId: userId, action: "snoozed", title: "비밀번호 변경 안내 — 나중에" },
  })
  const next = await passwordNoticeFor(userId)
  return NextResponse.json({ pending: true, snoozedUntil: next.snoozedUntil?.toISOString() ?? null })
}
