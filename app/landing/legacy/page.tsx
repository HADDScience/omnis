import type { Metadata } from "next"
import { LandingPage } from "@/components/landing/legacy/landing-page"

/*
 * 예전 랜딩(2026-10-29 까지 `/` 에 있던 것)을 지우지 않고 남겨 둔 자리 — mydocs/plans/archives/2026-10-29-landing-v2.md.
 * 지금의 Omnis 와 다른 기능(/업무 명령 · ⌘K)과 잰 적 없는 지표가 들어 있어 검색엔진에는 내보내지 않는다.
 * 로그인 여부와 상관없이 그대로 보인다 — `/` 와 달리 /chat 으로 보내지 않는다.
 */
export const metadata: Metadata = {
  title: "Omnis — 예전 랜딩",
  robots: { index: false, follow: false },
}

export default function LegacyLandingPage() {
  return <LandingPage />
}
