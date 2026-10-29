import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { LandingPage } from "@/components/landing/legacy/landing-page"

export default async function RootPage() {
  const session = await auth()
  // 로그인한 사람의 첫 화면은 옴니스 메신저. 방 목록 · 대화는 (main) 셸 안의 /chat 에 있다 —
  // 이 파일은 셸 밖(랜딩)이라 여기서 그리지 않고 보낸다
  if (session) redirect("/chat")
  return <LandingPage />
}
