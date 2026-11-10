import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { MessengerShell } from "@/components/messenger/messenger-shell"

// 옴니스 메신저 — 첫 화면(mydocs/plans/2026-10-28-omnis-messenger-agent.md 2단계).
// 목록은 이 레이아웃이 한 번 그리고, 방을 옮겨 다녀도 그대로 둔다(스크롤 · 불러온 목록이 유지된다).
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  return <MessengerShell userId={session.user.id}>{children}</MessengerShell>
}
