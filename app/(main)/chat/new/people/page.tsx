import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { NewPeopleChat } from "@/components/messenger/new-people-chat"

// 「사람과 대화」 — 구성원을 골라 1:1 · 단톡방을 연다(5단계). 옴니스 「새 대화」 는 /chat/new
export default async function NewPeopleChatPage() {
  const session = await auth()
  if (!session?.user?.id) notFound()
  return <NewPeopleChat me={{ id: session.user.id, name: session.user.name ?? "" }} />
}
