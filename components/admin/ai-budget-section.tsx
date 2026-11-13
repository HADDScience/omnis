import { AiBudgetForm } from "@/components/settings/ai-budget-form"
import { AiCostUsage } from "@/components/settings/ai-cost-usage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { loadBudget, loadRunCostBasis } from "@/lib/ai-budget"
import { budgetDefaults } from "@/lib/ai-budget-rules"
import { prisma } from "@/lib/db"
import { configuredRecipientIds } from "@/lib/notify-recipients"
import { SYSTEM_USER_ID } from "@/lib/system-user"

/** AI 비용 상한 · 전체 사용량 — /settings/ai-budget 과 /admin/usage 가 같이 쓴다. 권한은 부르는 화면이 본다 */
export async function AiBudgetSection({ userId }: { userId: string }) {
  const [budget, recipients, people, basis] = await Promise.all([
    loadBudget(),
    configuredRecipientIds(),
    prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID }, ...ACTIVE_MEMBER_WHERE }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    loadRunCostBasis(),
  ])
  const defaults = budgetDefaults()

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">상한</CardTitle>
        </CardHeader>
        <CardContent>
          <AiBudgetForm initial={{ ...budget, recipients }} people={people} defaults={{ userDailyKrw: defaults.userDailyKrw, monthlyKrw: defaults.monthlyKrw }} basis={basis} />
        </CardContent>
      </Card>
      <AiCostUsage userId={userId} isAdmin showAdminLink={false} />
    </div>
  )
}
