import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { MainWithChat } from "@/components/layout/main-with-chat"
import { CommandPaletteProvider } from "@/components/layout/command-palette-context"
import { RightPanelProvider } from "@/components/layout/right-panel-context"
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
    <SidebarProvider>
      <CommandPaletteProvider>
        <RightPanelProvider>
        <AppSidebar
          userName={session.user.name}
          userEmail={session.user.email}
          userRole={(session.user as { role?: string }).role ?? "MEMBER"}
        />
        <SidebarInset>
          <MainWithChat
            currentUserId={session.user.id as string}
            initialMessages={serializedMessages}
          >
            {children}
          </MainWithChat>
        </SidebarInset>
        </RightPanelProvider>
      </CommandPaletteProvider>
    </SidebarProvider>
  )
}
