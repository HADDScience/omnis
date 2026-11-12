import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { OnboardingReplay } from "@/components/settings/onboarding-replay"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { currentOnboardingVersion } from "@/lib/onboarding-version-store"

export const metadata: Metadata = { title: "온보딩 다시 띄우기" }
export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" })

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

  const [version, history] = await Promise.all([
    currentOnboardingVersion(),
    prisma.activityLog.findMany({
      where: { action: "onboarding.replayed" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, title: true, createdAt: true, user: { select: { name: true } } },
    }),
  ])

  return (
    <>
      <Header crumbs={["마이", "온보딩 다시 띄우기"]} />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">사용 안내</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              화면이 크게 바뀌었을 때 모두에게 안내를 한 번 더 보여 줍니다. 지금은{" "}
              <span data-onboarding-version className="font-medium text-foreground tabular-nums">{version}판</span>입니다.
            </p>
            <OnboardingReplay version={version} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">기록</CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 다시 띄운 적이 없습니다.</p>
            ) : (
              <ul data-onboarding-replay-history className="flex flex-col gap-1.5 text-[13px]">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground tabular-nums">{when.format(h.createdAt)}</span>
                    <span className="font-medium">{h.user?.name ?? "알 수 없음"}</span>
                    <span className="min-w-0">{h.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
