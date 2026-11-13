import type { Metadata } from "next"

import { UiMetricsSection } from "@/components/admin/ui-metrics-section"
import { Header } from "@/components/layout/header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"

export const metadata: Metadata = { title: "UI 변경 측정" }
export const dynamic = "force-dynamic"

/** 배포별 · 사람별 측정. 관리자만 연다. 같은 값을 GET /api/ui-metrics/summary 로도 받는다 */
export default async function UiMetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "UI 변경 측정"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>사람별 사용 기록이 있어 관리자 계정에만 열려 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  return (
    <>
      <Header crumbs={["마이", "UI 변경 측정"]} />
      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        <UiMetricsSection searchParams={await searchParams} />
      </div>
    </>
  )
}
