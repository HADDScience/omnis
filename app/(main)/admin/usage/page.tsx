import type { Metadata } from "next"

import { AiBudgetSection } from "@/components/admin/ai-budget-section"
import { UiMetricsSection } from "@/components/admin/ui-metrics-section"
import { requireAdminPage } from "@/lib/admin-access-server"

export const metadata: Metadata = { title: "비용·사용량" }
export const dynamic = "force-dynamic"

/** 비용·사용량 — AI 비용 상한 · 전체 사용량 · UI 변경 측정. /settings 의 두 화면과 같은 섹션을 쓴다 */
export default async function AdminUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const adminId = await requireAdminPage()
  return (
    <>
      <h1 className="sr-only">비용·사용량</h1>
      <section aria-labelledby="admin-budget-title" data-admin-budget className="flex flex-col gap-2">
        <h2 id="admin-budget-title" className="px-1 text-base font-semibold">AI 비용</h2>
        <AiBudgetSection userId={adminId} />
      </section>
      <section aria-labelledby="admin-metrics-title" data-admin-metrics className="glass flex flex-col gap-2 rounded-2xl p-4">
        <h2 id="admin-metrics-title" className="text-base font-semibold">UI 변경 측정</h2>
        <UiMetricsSection searchParams={await searchParams} />
      </section>
    </>
  )
}
