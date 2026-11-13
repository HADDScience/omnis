import { OnboardingReplay } from "@/components/settings/onboarding-replay"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { prisma } from "@/lib/db"
import { currentOnboardingVersion } from "@/lib/onboarding-version-store"

const when = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" })

/** 모두에게 온보딩 다시 띄우기 — /settings/onboarding 과 /admin/operations 가 같이 쓴다. 권한은 부르는 화면이 본다 */
export async function OnboardingSection({ historyTitle = "기록" }: { historyTitle?: string }) {
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
          <div className="border-t pt-3">
            <h3 className="mb-1.5 text-[13px] font-medium">{historyTitle}</h3>
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
          </div>
        </CardContent>
      </Card>
    </>
  )
}
