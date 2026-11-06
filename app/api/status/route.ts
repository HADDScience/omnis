import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SIMULATE_COOKIE, readMaintenanceState, simulatedState } from "@/lib/maintenance/state"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 점검 스위치의 지금 값 — 열린 화면(components/layout/notice-banner.tsx)이 25초마다 묻는다.
 * DB · 인증을 쓰지 않는다. proxy 를 거치지 않는다(proxy.ts 의 matcher).
 *
 * CDN 이 20초 들고 있어(s-maxage) 화면이 여럿이어도 스토어 읽기는 20초에 한 번 정도다.
 * 함수 안 캐시는 5초 — CDN 이 못 잡는 몰린 요청만 막는다. 늦어지는 최댓값:
 * 전파 10초 + CDN 20초 + 5초 + 폴링 25초 = 60초.
 */
export async function GET() {
  const sim = simulatedState((await cookies()).get(SIMULATE_COOKIE)?.value)
  const state = sim ?? (await readMaintenanceState({ maxAgeSeconds: 5 }))
  return NextResponse.json(state, {
    headers: {
      // 흉내 쿠키는 그 브라우저 한 곳의 값이다 — 공유 캐시에 올리지 않는다
      "Cache-Control": sim ? "no-store" : "public, max-age=0, s-maxage=20",
    },
  })
}
