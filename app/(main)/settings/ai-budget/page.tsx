import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { AiBudgetForm } from "@/components/settings/ai-budget-form"
import { AiCostUsage } from "@/components/settings/ai-cost-usage"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { loadBudget } from "@/lib/ai-budget"
import { budgetDefaults } from "@/lib/ai-budget-rules"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { configuredRecipientIds } from "@/lib/notify-recipients"
import { SYSTEM_USER_ID } from "@/lib/system-user"

export const metadata: Metadata = { title: "AI 비용 상한" }
export const dynamic = "force-dynamic"

/** AI 비용 상한 조정 · 전체 사용량. 관리자만 — 저장하면 재배포 없이 바로 쓴다(AppSetting) */
export default async function AiBudgetPage() {
  const session = await auth()
  const userId = session?.user?.id
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!userId || !isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "AI 비용 상한"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>내 사용량은 마이 → 사용량에서 볼 수 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  const [budget, recipients, people] = await Promise.all([
    loadBudget(),
    configuredRecipientIds(),
    prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID }, ...ACTIVE_MEMBER_WHERE }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ])
  const defaults = budgetDefaults()

  return (
    <>
      <Header crumbs={["마이", "AI 비용 상한"]} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">상한</CardTitle>
          </CardHeader>
          <CardContent>
            <AiBudgetForm initial={{ ...budget, recipients }} people={people} defaults={{ userDailyKrw: defaults.userDailyKrw, monthlyKrw: defaults.monthlyKrw }} />
          </CardContent>
        </Card>
        <AiCostUsage userId={userId} isAdmin showAdminLink={false} />
      </div>
    </>
  )
}
