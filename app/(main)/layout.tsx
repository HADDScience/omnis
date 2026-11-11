import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { FloatingNav } from "@/components/layout/floating-nav"
import { CurrentUserProvider } from "@/components/layout/current-user"
import { MainWithChat } from "@/components/layout/main-with-chat"
import { RightPanelProvider } from "@/components/layout/right-panel-context"
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider"
import { PwaRegister } from "@/components/pwa-register"
import { PushPresence } from "@/components/push-presence"
import { AppNudge } from "@/components/layout/app-nudge"
import { UiMetrics } from "@/components/layout/ui-metrics"
import { LargeUploadStatus } from "@/components/layout/large-upload-status"
import { mustChangePassword } from "@/lib/password-state"
import { PasswordResetNotice } from "@/components/auth/password-reset-notice"

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const onboarding = await prisma.user.findFirst({
    where: { id: session.user.id, isActive: true },
    select: { onboardingVideoSeenAt: true, onboardingCompletedAt: true },
  })
  if (!onboarding) redirect("/login")
  // 관리자가 정해 준 비밀번호를 쓰는 동안에는 바꾸라고 권한다. 막지는 않는다(2026-11-06 핫픽스)
  const passwordResetPending = await mustChangePassword(session.user.id as string)

  return (
    // 사이드바 대신 떠 있는 nav(mydocs/plans/2026-10-28-floating-nav.md). 셸은 화면 높이 그대로 한 칸이다
    <div className="flex min-h-[calc(var(--app-vh)-var(--demo-banner-height,0px))] w-full">
      <PwaRegister />
      <PushPresence />
      <CurrentUserProvider name={session.user.name ?? null}>
        <RightPanelProvider userId={session.user.id as string}>
        <OnboardingProvider key={session.user.id} initialState={{
          onboardingVideoSeenAt: onboarding.onboardingVideoSeenAt?.toISOString() ?? null,
          onboardingCompletedAt: onboarding.onboardingCompletedAt?.toISOString() ?? null,
        }}>
        <main className="relative flex w-full flex-1 flex-col bg-background">
          <MainWithChat currentUserId={session.user.id as string}>
            {children}
          </MainWithChat>
        </main>
        <FloatingNav />
        {/* 앱 설치 · 기기 알림 권유 — 사용 안내가 끝난 뒤에만 뜬다 */}
        <AppNudge />
        {passwordResetPending && <PasswordResetNotice />}
        <UiMetrics userId={session.user.id as string} />
        <LargeUploadStatus />
        </OnboardingProvider>
        </RightPanelProvider>
      </CurrentUserProvider>
    </div>
  )
}
