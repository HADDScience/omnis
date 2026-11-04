import type { Metadata } from "next"
import { LandingV2 } from "@/components/landing/landing-v2/landing-page"
import { getLandingStats } from "@/lib/landing-stats"

/*
 * 2026-10-29 ~ 30 에 `/` 에 있던 랜딩(mydocs/plans/archives/2026-10-29-landing-v2.md). `/` 가 모션 랜딩
 * (mydocs/plans/2026-10-30-landing-motion-story.md)으로 바뀌어 지우지 않고 남겨 둔 자리. 검색엔진에는 내보내지 않는다.
 */
export const metadata: Metadata = {
  title: "Omnis — 랜딩 v2",
  robots: { index: false, follow: false },
}

export default async function LandingV2Page() {
  return <LandingV2 stats={await getLandingStats()} />
}
