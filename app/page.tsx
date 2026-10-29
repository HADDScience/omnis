import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { LandingV2 } from "@/components/landing/landing-v2/landing-page"
import { getLandingStats } from "@/lib/landing-stats"

export default async function RootPage() {
  const session = await auth()
  // 로그인한 사람의 첫 화면은 옴니스 메신저. 방 목록 · 대화는 (main) 셸 안의 /chat 에 있다 —
  // 이 파일은 셸 밖(랜딩)이라 여기서 그리지 않고 보낸다. 예전 랜딩은 /landing/legacy 에 남아 있다
  if (session) redirect("/chat")
  // 개수만, 한 시간 캐시(lib/landing-stats.ts). 실패하면 null 이고 랜딩은 그 섹션만 숨긴다
  return <LandingV2 stats={await getLandingStats()} />
}
