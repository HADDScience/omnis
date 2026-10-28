import { OmnisRoom } from "@/components/messenger/omnis-room"

// /chat — PC 는 목록 옆에 「새 대화」 칸, 폰은 목록만 보인다(MessengerShell). 「새 대화」 는 /chat/new 와 같은 칸이다
export default function ChatHomePage() {
  return <OmnisRoom roomId={null} initialMessages={[]} />
}
