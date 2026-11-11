import { Header } from "@/components/layout/header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { redirect } from "next/navigation"
import { SocialBadge } from "@/components/settings/social-badge"
import { loadMyProfile } from "@/lib/my-profile"
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SettingsTabs } from "@/components/settings/settings-tabs"
import { legacySettingsRedirect, PROFILE_HREF, UI_METRICS_NOTICE_ANCHOR } from "@/lib/settings-tab"
import { AiCostUsage } from "@/components/settings/ai-cost-usage"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { surveyEntryFor } from "@/lib/ai-survey/service"
import { MyShortcuts } from "@/components/settings/my-shortcuts"
import { SurveyEntryCard } from "@/components/settings/survey-entry-card"
import { PushNotifications } from "@/components/settings/push-notifications"
import { NotificationKinds } from "@/components/settings/notification-kinds"
import { auth } from "@/lib/auth"
import { UI_METRICS_NOTICE } from "@/lib/ui-metrics/notice"
import Link from "next/link"

export const dynamic = "force-dynamic"

/**
 * 마이 탭 — 내 계정을 보는 자리다. 프로젝트 정리(병합)는 남의 업무까지 옮기는
 * 작업이라 개인 설정이 아니다 — /tasks/projects 로 옮겼다. (2026-09-09)
 *
 * 사이드바를 걷으면서(2026-10-28) 프로필 메뉴에 있던 MCP 등록·튜토리얼·테마·로그아웃이 여기로 왔다.
 * 카드를 세로로 셋 넘게 쌓지 않으려고(규칙 17) 설정 카드들은 탭으로 묶는다.
 *
 * 2026-11-06: 탭은 알림 설정 · 사용량 · 앱 정보 셋. 연결된 계정 · 비밀번호는 프로필 카드를 누른 프로필 설정(/settings/profile)으로,
 * ⌘K 검색 줄은 걷고 그 자리에 앱 설치 줄. 옛 `?tab=` 은 redirect 한다(lib/settings-tab.ts).
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const params = await searchParams
  // 소셜 연결 실패는 프로필 설정에서 보인다(lib/auth.ts). 옛 탭 주소는 같은 내용의 새 자리로
  if (params.error) redirect(`${PROFILE_HREF}?error=${encodeURIComponent(params.error)}`)
  const legacy = legacySettingsRedirect(params.tab)
  if (legacy) redirect(legacy)

  const session = await auth()
  const user = session?.user
  const role = (user as { role?: string } | undefined)?.role ?? "MEMBER"
  const profile = user?.id ? await loadMyProfile(user.id) : null
  const survey = user?.id && surveyAllowed(user.id) ? await surveyEntryFor(user.id) : null

  return (
    <>
      <Header title="마이" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        {/* 누르면 프로필 설정 — 내 정보 · 비밀번호 · 소셜 연결(2026-11-06) */}
        <Link
          href={PROFILE_HREF}
          data-profile-card
          className="touch-target flex items-center gap-3 rounded-lg px-1 py-1 transition-colors hover:bg-muted/60"
        >
          <Avatar className="size-12">
            <AvatarFallback className="text-base font-semibold">{(profile?.name ?? user?.name)?.charAt(0) ?? "?"}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold">{profile?.name ?? user?.name ?? "사용자"}</span>
              {profile?.social.map((p) => (
                <SocialBadge key={p} provider={p} />
              ))}
            </span>
            {profile?.email && <span className="truncate text-[12px] text-muted-foreground">{profile.email}</span>}
            {/* 직급 — 인력 표의 직함. 없으면 비워 둔다(역할 ADMIN 은 보이지 않는다) */}
            <span data-profile-title className="min-h-[15px] truncate text-[11.5px] text-muted-foreground">
              {profile?.title ?? ""}
            </span>
          </div>
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
        </Link>

        {/* AI 활용 설문 카드(2026-11-11) — 로그아웃 줄 바로 아래. 허용한 계정에만 보인다(lib/ai-survey/access.ts) */}
        <MyShortcuts below={survey ? <SurveyEntryCard entry={survey.entry} /> : null} />

        <SettingsTabs>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="notify">알림 설정</TabsTrigger>
            <TabsTrigger value="usage">사용량</TabsTrigger>
            <TabsTrigger value="info">앱 정보</TabsTrigger>
          </TabsList>
          <TabsContent value="notify" className="mt-3 flex flex-col gap-4">
            <PushNotifications />
            <NotificationKinds />
          </TabsContent>
          <TabsContent value="usage" className="mt-3">
            {user?.id ? <AiCostUsage userId={user.id} isAdmin={role === "ADMIN"} /> : null}
          </TabsContent>
          <TabsContent value="info" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">시스템 설정</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  사용자 관리, Gemini API 키, 시스템 설정을 관리합니다.
                </p>
                {role === "ADMIN" && (
                  <span className="mt-2 flex flex-wrap gap-x-4">
                    <Link href="/settings/feature-requests" className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
                      기능 요청 보기
                    </Link>
                    <Link href="/settings/ai-budget" className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
                      AI 비용 상한
                    </Link>
                    {/* 설문 결과(회사 전체 추정 · 원문) — 설문이 열린 관리자만 */}
                    {survey && (
                      <Link href="/settings/ai-survey/results" data-ai-survey-results-link className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
                        AI 활용 설문 결과
                      </Link>
                    )}
                  </span>
                )}
              </CardContent>
            </Card>
            <Card id={UI_METRICS_NOTICE_ANCHOR} className="mt-4" data-ui-metrics-notice>
              <CardHeader>
                <CardTitle className="text-base">{UI_METRICS_NOTICE.title}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                <p>모으는 것: {UI_METRICS_NOTICE.collected}</p>
                <p>모으지 않는 것: {UI_METRICS_NOTICE.notCollected}</p>
                <p>{UI_METRICS_NOTICE.usage}</p>
                <p>{UI_METRICS_NOTICE.retention}</p>
                {role === "ADMIN" && (
                  <Link href="/settings/ui-metrics" className="touch-target w-fit font-medium text-foreground underline underline-offset-4">
                    배포별 측정 보기
                  </Link>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </SettingsTabs>
      </div>
    </>
  )
}
