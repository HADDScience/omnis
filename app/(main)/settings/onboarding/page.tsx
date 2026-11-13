import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { OnboardingSection } from "@/components/admin/onboarding-section"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"

export const metadata: Metadata = { title: "온보딩 다시 띄우기" }
export const dynamic = "force-dynamic"

/** 사용 안내를 모두에게 다시 띄운다 — 코드 · 배포 없이 판을 올린다(lib/onboarding-version.ts). 관리자만 */
export default async function OnboardingSettingsPage() {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!session?.user?.id || !isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "온보딩 다시 띄우기"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>안내는 마이에서 언제든 다시 볼 수 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  return (
    <>
      <Header crumbs={["마이", "온보딩 다시 띄우기"]} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <OnboardingSection />
      </div>
    </>
  )
}
