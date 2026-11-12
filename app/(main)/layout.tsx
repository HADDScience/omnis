import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { FloatingNav } from "@/components/layout/floating-nav"
import { CurrentUserProvider } from "@/components/layout/current-user"
import { MainWithChat } from "@/components/layout/main-with-chat"
import { RightPanelProvider } from "@/components/layout/right-panel-context"
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider"
import { surveyAllowed } from "@/lib/ai-survey/access"
import { currentOnboardingVersion } from "@/lib/onboarding-version-store"
import { PwaRegister } from "@/components/pwa-register"
import { PushPresence } from "@/components/push-presence"
import { AppNudge } from "@/components/layout/app-nudge"
import { UiMetrics } from "@/components/layout/ui-metrics"
import { LargeUploadStatus } from "@/components/layout/large-upload-status"
import { RoomDownloadStatus } from "@/components/layout/room-download-status"
import { passwordNoticeFor } from "@/lib/password-state"
import { redirect } from "next/navigation"
import { PasswordResetNotice } from "@/components/auth/password-reset-notice"
import { AppSplash } from "@/components/layout/app-splash"
import { redirectToLogin } from "@/lib/login-redirect"

/**
 * 셸 바깥은 아무것도 기다리지 않는다 — 첫 HTML 조각(루트 레이아웃 + 스플래시)이 곧장 나가고, 세션 · 사용자 정보를 읽는
 * 셸(MainShell)은 뒤따라 흘려보낸다. 예전에는 이 읽기가 끝나야 응답의 첫 바이트가 나갔다 — 콜드 스타트 · DB 깨우기와 겹치면
 * 운영 첫 응답이 3초를 넘었다(2026-11-12 실측), 그동안 홈 화면 앱은 빈 화면이었다. 로그인하지 않았으면 셸이 /login 으로 보낸다
 * (첫 조각이 이미 나간 뒤라 Next 가 클라이언트에서 옮긴다).
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppSplash />}>
      <MainShell>{children}</MainShell>
    </Suspense>
  )
}

async function MainShell({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    return redirectToLogin()
  }

  const [onboarding, onboardingCurrent] = await Promise.all([
    prisma.user.findFirst({
      where: { id: session.user.id, isActive: true },
      select: { onboardingVideoSeenAt: true, onboardingCompletedAt: true, onboardingVersion: true },
    }),
    currentOnboardingVersion(),
  ])
  if (!onboarding) return redirectToLogin()
  // 관리자가 정해 준 비밀번호를 쓰는 동안에는 바꾸라고 권한다. 막지는 않는다(2026-11-06 핫픽스).
  // 「나중에」 7일 동안은 안내만 숨기고 마이 진입점의 경고 점은 남긴다(2026-11-11, lib/password-notice.ts)
  const password = await passwordNoticeFor(session.user.id as string)
  // 로그인 코드로 들어왔으면 새 비밀번호부터 — 건너뛰기 없음(lib/login-code.ts)
  if (password.mustSet) redirect("/account/password")

  return (
    // 사이드바 대신 떠 있는 nav(mydocs/plans/2026-10-28-floating-nav.md). 셸은 화면 높이 그대로 한 칸이다
    <div className="flex min-h-[calc(var(--app-vh)-var(--demo-banner-height,0px))] w-full">
      <PwaRegister />
      <PushPresence />
      <CurrentUserProvider name={session.user.name ?? null} passwordPending={password.pending}>
        <RightPanelProvider userId={session.user.id as string}>
        <OnboardingProvider key={session.user.id} survey={surveyAllowed(session.user.id)} currentVersion={onboardingCurrent} initialState={{
          onboardingVideoSeenAt: onboarding.onboardingVideoSeenAt?.toISOString() ?? null,
          onboardingCompletedAt: onboarding.onboardingCompletedAt?.toISOString() ?? null,
          onboardingVersion: onboarding.onboardingVersion,
        }}>
        <main className="relative flex w-full flex-1 flex-col bg-background">
          <MainWithChat currentUserId={session.user.id as string}>
            {children}
          </MainWithChat>
        </main>
        <FloatingNav />
        {/* 앱 설치 · 기기 알림 권유 — 사용 안내가 끝난 뒤에만 뜬다 */}
        <AppNudge />
        {password.showNotice && <PasswordResetNotice />}
        <UiMetrics userId={session.user.id as string} />
        <LargeUploadStatus />
        <RoomDownloadStatus />
        </OnboardingProvider>
        </RightPanelProvider>
      </CurrentUserProvider>
    </div>
  )
}
