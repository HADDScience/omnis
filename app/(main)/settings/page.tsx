import { Header } from "@/components/layout/header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { redirect } from "next/navigation"
import { SocialBadge } from "@/components/settings/social-badge"
import { loadMyProfile } from "@/lib/my-profile"
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SettingsTabs } from "@/components/settings/settings-tabs"
import { legacySettingsRedirect, PROFILE_HREF } from "@/lib/settings-tab"
import { AiCostUsage } from "@/components/settings/ai-cost-usage"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { MyShortcuts } from "@/components/settings/my-shortcuts"
import { PushNotifications } from "@/components/settings/push-notifications"
import { NotificationKinds } from "@/components/settings/notification-kinds"
import { GeneralSettings } from "@/components/settings/general-settings"
import { auth } from "@/lib/auth"
import { currentAppVersion } from "@/lib/app-version"
import { passwordNoticeFor } from "@/lib/password-state"
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
 *
 * 2026-11-11: 「알림 설정」 앞에 「일반」(테마 · 키보드 단축키). 앱 정보는 버전과 약관 · 개인정보 처리방침 링크만 —
 * 「시스템 설정」 카드와 「사용 기록 안내」 는 걷었다(안내는 개인정보 처리방침의 한 절로 옮김). 관리자 화면 링크는 관리자에게만 한 줄로 남긴다.
 * 임시 비밀번호를 쓰는 동안 프로필 카드 아래에 경고 줄을 둔다(lib/password-notice.ts).
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
  const password = user?.id ? await passwordNoticeFor(user.id) : null
  const version = currentAppVersion()

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

        {/* 임시 비밀번호 — 바꿀 때까지 남는다. 마이 아바타의 경고 점과 같은 상태다 */}
        {password?.pending && (
          <Link
            href="/account/password"
            data-password-warning
            className="touch-target -mt-2 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12.5px] text-destructive transition-colors hover:bg-destructive/10"
          >
            <HugeiconsIcon icon={Alert02Icon} size={15} className="shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">관리자가 정해 준 임시 비밀번호를 쓰고 있습니다. 본인만 아는 비밀번호로 바꾸세요.</span>
            <span className="shrink-0 font-medium underline underline-offset-4">바꾸기</span>
          </Link>
        )}

        <MyShortcuts />

        <SettingsTabs>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">일반</TabsTrigger>
            <TabsTrigger value="notify">알림 설정</TabsTrigger>
            <TabsTrigger value="usage">사용량</TabsTrigger>
            <TabsTrigger value="info">앱 정보</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="mt-3">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="notify" className="mt-3 flex flex-col gap-4">
            <PushNotifications />
            <NotificationKinds />
          </TabsContent>
          <TabsContent value="usage" className="mt-3">
            {/* AI 활용 설문(2026-11-11) — 허용한 계정에만 보인다(lib/ai-survey/access.ts). 결과(회사 전체 추정 · 원문)는 그중 관리자만 */}
            {surveyAllowed(user?.id) && (
              <div data-ai-survey-entry className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">AI 활용 설문</span>
                  <span className="text-xs text-muted-foreground">AI 를 얼마나 · 어디에 쓰는지 눌러서 답합니다. 2~3분.</span>
                </div>
                <span className="flex flex-wrap gap-x-4">
                  <Link href="/settings/ai-survey" className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
                    설문 하기
                  </Link>
                  {role === "ADMIN" && (
                    <Link href="/settings/ai-survey/results" className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
                      결과 보기
                    </Link>
                  )}
                </span>
              </div>
            )}
            {user?.id ? <AiCostUsage userId={user.id} isAdmin={role === "ADMIN"} /> : null}
          </TabsContent>
          <TabsContent value="info" className="mt-3 flex flex-col gap-4">
            <dl data-app-version className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 rounded-xl border bg-card px-4 py-3 text-sm">
              <dt className="text-muted-foreground">앱 버전</dt>
              <dd className="font-medium tabular-nums">{version.version}</dd>
              <dt className="text-muted-foreground">배포</dt>
              <dd className="tabular-nums">
                {version.commit ? <span className="font-mono">{version.commit}</span> : "로컬 빌드"}
                {version.builtOn && <span className="text-muted-foreground"> · {version.builtOn}</span>}
              </dd>
            </dl>
            <nav aria-label="약관" className="flex flex-col divide-y rounded-xl border bg-card">
              {[
                { href: "/terms", label: "서비스 이용약관" },
                { href: "/privacy", label: "개인정보 처리방침" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="touch-target flex items-center justify-between px-4 py-3 text-sm transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60">
                  {l.label}
                  <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </nav>
            {/* 관리자 화면 — 예전 「시스템 설정」 카드에 있던 링크. 관리자에게만 */}
            {role === "ADMIN" && (
              <p data-admin-links className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12.5px] text-muted-foreground">
                <span>관리</span>
                <Link href="/settings/feature-requests" className="touch-target inline-flex items-center underline underline-offset-4 hover:text-foreground">
                  기능 요청 보기
                </Link>
                <Link href="/settings/ai-budget" className="touch-target inline-flex items-center underline underline-offset-4 hover:text-foreground">
                  AI 비용 상한
                </Link>
                <Link href="/settings/ui-metrics" className="touch-target inline-flex items-center underline underline-offset-4 hover:text-foreground">
                  배포별 측정 보기
                </Link>
              </p>
            )}
          </TabsContent>
        </SettingsTabs>
      </div>
    </>
  )
}
