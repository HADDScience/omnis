import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { FeatureRequestsSection } from "@/components/admin/feature-requests-section"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"

export const metadata: Metadata = { title: "기능 요청" }
export const dynamic = "force-dynamic"

/** 옴니스가 「지금 없는 기능」 으로 개발자에게 전달한 요청. 같은 요청은 한 줄로 묶인다. 관리자만 */
export default async function FeatureRequestsPage() {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "기능 요청"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>요청한 사람과 대화 위치가 있어 관리자 계정에만 열려 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  return (
    <>
      <Header crumbs={["마이", "기능 요청"]} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <FeatureRequestsSection />
      </div>
    </>
  )
}
