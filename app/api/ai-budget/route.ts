import { NextResponse, type NextRequest } from "next/server"

import { apiError, parseJson, writeActivity } from "@/lib/api"
import { auth } from "@/lib/auth"
import { loadBudget, saveBudget } from "@/lib/ai-budget"
import { configuredRecipientIds, saveRecipientIds } from "@/lib/notify-recipients"
import { SaveBudgetSchema } from "@/lib/schemas/ai-budget"

export const runtime = "nodejs"

async function admin() {
  const session = await auth()
  if (!session?.user?.id) return { fail: apiError(401, "인증 필요") }
  if ((session.user as { role?: string }).role !== "ADMIN") return { fail: apiError(403, "관리자만 바꿀 수 있습니다") }
  return { userId: session.user.id }
}

/** 지금 상한 · 받는 사람. 관리자만 */
export async function GET() {
  const a = await admin()
  if ("fail" in a) return a.fail
  return NextResponse.json({ ...(await loadBudget()), recipients: await configuredRecipientIds() })
}

/** 상한 · 사람별 예외 · 받는 사람 저장 — 다음 요청부터 바로 쓴다(재배포 없음) */
export async function PUT(req: NextRequest) {
  const a = await admin()
  if ("fail" in a) return a.fail
  const parsed = SaveBudgetSchema.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, parsed.error.issues[0]?.message ?? "잘못된 요청입니다")
  const { recipients, ...budget } = parsed.data
  await saveBudget(budget, a.userId)
  await saveRecipientIds(recipients, a.userId)
  await writeActivity({ userId: a.userId, action: "ai_budget.saved", entity: "AppSetting", entityId: "ai_budget", title: "AI 비용 상한 저장" }).catch(() => {})
  return NextResponse.json({ ...budget, recipients })
}
