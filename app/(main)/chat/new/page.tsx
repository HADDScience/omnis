import { OmnisRoom } from "@/components/messenger/omnis-room"

// 새 대화 — 첫 글을 보내는 순간 옴니스 1:1 방이 생긴다(빈 방을 미리 만들지 않는다)
export default function NewChatPage() {
  return <OmnisRoom roomId={null} initialMessages={[]} />
}
