import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { MainWithChat } from "@/components/layout/main-with-chat"
import { CommandPaletteProvider } from "@/components/layout/command-palette-context"

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const messages = await prisma.chatMessage.findMany({
    where: { roomId: "default-room" },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      author: { select: { id: true, name: true } },
      task: { select: { id: true, name: true, slug: true } },
      files: { select: { id: true, name: true, path: true, size: true, mimeType: true } },
    },
  })

  const serializedMessages = messages.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }))

  return (
    <SidebarProvider>
      <CommandPaletteProvider>
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
      </CommandPaletteProvider>
    </SidebarProvider>
  )
}
