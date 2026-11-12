import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { loadTaskRoom } from "@/lib/chat-task-room"
import { TaskRoom } from "@/components/messenger/task-room"

export const dynamic = "force-dynamic"

// 업무방 — 표가 없다. 업무에 묶인 글(taskId)을 방처럼 보여 준다. 스레드는 업무 상세 · 오른쪽 패널과 같은 TaskThread 다.
// 글 · 머리줄은 오른쪽 패널의 업무방과 같이 쓴다(lib/chat-task-room.ts · components/messenger/task-room.tsx)
export default async function TaskRoomPage({ params }: { params: Promise<{ taskId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) notFound()
  const { taskId } = await params
  const room = await loadTaskRoom(taskId, session.user.id)
  if (!room) notFound()
  return <TaskRoom room={room} currentUserId={session.user.id} />
}
