// 월 상한 80% · 100% 알림 — 개발자(lib/notify-recipients)에게 옴니스 알림 + 메일. 같은 달 같은 단계는 한 번(AppSetting 표시).
// AI 사용을 남길 때마다 부르되, 한 서버 인스턴스에서 1분에 한 번만 DB 를 본다.
import { prisma } from "@/lib/db"
import { claimOnce } from "@/lib/app-settings"
import { dueAlertLevels, kstMonthKey, kstMonthStart, mergeBudget, budgetDefaults } from "@/lib/ai-budget-rules"
import { readSetting } from "@/lib/app-settings"
import { notifyDevelopers } from "@/lib/notify-recipients"

export const BUDGET_NOTIFY_TYPE = "ai_budget"
const THROTTLE_MS = 60_000
let lastCheck = 0

/** 기다리지 않아도 되는 확인 — 실패해도 부른 쪽을 멈추지 않는다 */
export async function checkBudgetAlertsSoon(): Promise<void> {
  const now = Date.now()
  if (now - lastCheck < THROTTLE_MS) return
  lastCheck = now
  try {
    await checkBudgetAlerts()
  } catch (err) {
    console.error("[ai-budget] 알림 확인 실패", err)
  }
}

export async function checkBudgetAlerts(now = new Date()): Promise<number[]> {
  const budget = mergeBudget(budgetDefaults(), await readSetting("ai_budget"))
  const month = kstMonthKey(now)
  const sum = await prisma.aiUsage.aggregate({ where: { createdAt: { gte: kstMonthStart(now) } }, _sum: { costKrw: true } })
  const used = Number(sum._sum.costKrw ?? 0)
  const sentRows = await prisma.appSetting.findMany({ where: { key: { startsWith: `ai_budget_alert:${month}:` } }, select: { key: true } })
  const sent = sentRows.map((r) => Number(r.key.split(":").pop()))
  const sentNow: number[] = []
  for (const level of dueAlertLevels(used, budget.monthlyKrw, sent)) {
    // 동시에 둘이 넘어도 하나만 보낸다
    if (!(await claimOnce(`ai_budget_alert:${month}:${level}`, { usedKrw: Math.round(used), limitKrw: budget.monthlyKrw }))) continue
    const title = `AI 비용 ${month} 월 상한의 ${level}% 도달`
    const line = `이번 달 ${Math.round(used).toLocaleString("ko-KR")}원 / 상한 ${budget.monthlyKrw.toLocaleString("ko-KR")}원`
    await notifyDevelopers({
      type: BUDGET_NOTIFY_TYPE, title, content: line, entityId: `${month}:${level}`,
      mailSubject: `[Omnis] ${title}`,
      mailBody: [title, "", line, level >= 100 ? "새 옴니스 대화가 막힙니다. 관리 화면에서 월 상한을 올릴 수 있습니다." : "", "관리: /settings/ai-budget"].filter(Boolean).join("\n"),
    })
    sentNow.push(level)
  }
  return sentNow
}
