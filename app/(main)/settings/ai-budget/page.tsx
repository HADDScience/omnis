import type { Metadata } from "next"

import { AiBudgetSection } from "@/components/admin/ai-budget-section"
import { Header } from "@/components/layout/header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"

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

  return (
    <>
      <Header crumbs={["마이", "AI 비용 상한"]} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <AiBudgetSection userId={userId} />
      </div>
    </>
  )
}
