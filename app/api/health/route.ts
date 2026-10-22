import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * 가동률 확인용. 서버 함수가 도는지만 본다 — `.github/workflows/uptime.yml` 이 30분마다 친다.
 *
 * DB 에 닿지 않는다. Neon 은 깨어 있던 시간이 요금이라(mydocs/working/2026-09-28-neon-wake-time.md)
 * 30분마다 깨우면 하루 48번 값이 붙는다. DB 장애는 이 응답이 아니라 Vercel 에러 묶음에서 본다.
 */
export function GET() {
  return NextResponse.json(
    { ok: true, sha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { headers: { "Cache-Control": "no-store" } }
  )
}
