import { NextResponse, type NextRequest } from "next/server"

import { apiError, parseJson, writeActivity } from "@/lib/api"
import { auth } from "@/lib/auth"
import { loadBudget, saveBudget } from "@/lib/ai-budget"
import { userDailyLimit } from "@/lib/ai-budget-rules"
import { RaiseBudgetSchema } from "@/lib/schemas/ai-budget"

export const runtime = "nodejs"

/**
 * 한도 도달 안내의 「한도 올리기」 — 관리자만. 올리기만 한다(지금보다 낮은 값은 관리 화면에서).
 * 하루 상한은 그 사람의 예외 상한으로, 월 상한은 회사 값으로 저장한다. 다음 요청부터 바로 쓴다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  if ((session.user as { role?: string }).role !== "ADMIN") return apiError(403, "관리자만 한도를 올릴 수 있습니다")
  const parsed = RaiseBudgetSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const r = parsed.data
  const b = await loadBudget()
  const before = r.kind === "monthly" ? b.monthlyKrw : userDailyLimit(b, r.userId)
  if (r.toKrw <= before) return apiError(400, `지금 한도(${before.toLocaleString("ko-KR")}원)보다 높아야 합니다`)
  const next = r.kind === "monthly" ? { ...b, monthlyKrw: r.toKrw } : { ...b, users: { ...b.users, [r.userId]: r.toKrw } }
  await saveBudget(next, session.user.id)
  await writeActivity({
    userId: session.user.id, action: "ai_budget.raised", entity: "AppSetting", entityId: "ai_budget",
    title: `AI ${r.kind === "monthly" ? "월" : "하루"} 한도 ${before.toLocaleString("ko-KR")} → ${r.toKrw.toLocaleString("ko-KR")}원`,
    metadata: { kind: r.kind, before, after: r.toKrw, ...(r.kind === "user_daily" ? { userId: r.userId } : {}) },
  })
  return NextResponse.json({ kind: r.kind, before, after: r.toKrw })
}
