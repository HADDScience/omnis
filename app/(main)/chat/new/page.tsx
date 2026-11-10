import { OmnisRoom } from "@/components/messenger/omnis-room"
import { TASK_START_PARAM } from "@/lib/task-start"

// 새 대화 — 첫 글을 보내는 순간 옴니스 1:1 방이 생긴다(빈 방을 미리 만들지 않는다).
// `?start=<키>` 는 폰의 「Omnis 와 함께 업무 시작하기」 가 넘긴 일회용 키 — 그 업무 글을 한 번 보낸다(lib/task-start.ts)
export default async function NewChatPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const start = (await searchParams)[TASK_START_PARAM]
  const key = typeof start === "string" && /^[\w-]{8,64}$/.test(start) ? start : undefined
  return <OmnisRoom key={key ?? "new"} roomId={null} initialMessages={[]} autoStartKey={key} />
}
