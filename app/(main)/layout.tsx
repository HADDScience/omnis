import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { FloatingNav } from "@/components/layout/floating-nav"
import { CurrentUserProvider } from "@/components/layout/current-user"
import { MainWithChat } from "@/components/layout/main-with-chat"
import { CommandPaletteProvider } from "@/components/layout/command-palette-context"
import { RightPanelProvider } from "@/components/layout/right-panel-context"
import { OnboardingProvider } from "@/components/onboarding/onboarding-provider"
import { PwaRegister } from "@/components/pwa-register"
import { CHAT_PAGE_SIZE } from "@/lib/constants"

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

  // 최신 메시지 한 페이지를 가져와 화면 표시용 오름차순으로 정렬
  const recentMessages = await prisma.chatMessage.findMany({
    where: { roomId: "default-room" },
    orderBy: { createdAt: "desc" },
    take: CHAT_PAGE_SIZE,
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  const serializedMessages = recentMessages.reverse().map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))

  return (
    // 사이드바 대신 떠 있는 nav(mydocs/plans/2026-10-28-floating-nav.md). 셸은 화면 높이 그대로 한 칸이다
    <div className="flex min-h-[calc(var(--app-vh)-var(--demo-banner-height,0px))] w-full">
      <PwaRegister />
      <CurrentUserProvider name={session.user.name ?? null}>
      <CommandPaletteProvider>
        <RightPanelProvider>
        <OnboardingProvider key={session.user.id} initialState={{
          onboardingVideoSeenAt: onboarding.onboardingVideoSeenAt?.toISOString() ?? null,
          onboardingCompletedAt: onboarding.onboardingCompletedAt?.toISOString() ?? null,
        }}>
        <main className="relative flex w-full flex-1 flex-col bg-background">
          <MainWithChat
            currentUserId={session.user.id as string}
            initialMessages={serializedMessages}
          >
            {children}
          </MainWithChat>
        </main>
        <FloatingNav />
        </OnboardingProvider>
        </RightPanelProvider>
      </CommandPaletteProvider>
      </CurrentUserProvider>
    </div>
  )
}
