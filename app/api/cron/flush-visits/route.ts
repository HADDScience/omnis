import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { flushVisits } from "@/lib/website-visits"

/**
 * 버퍼에 쌓인 홈페이지 방문을 Postgres 로 옮긴다. 하루 한 번(`vercel.json` 의 crons).
 *
 * **하루 한 번인 것이 핵심이다.** Neon 은 마지막 질의 5분 뒤에 자므로 크론 한 번이
 * 최소 5분을 깨운다. 한 시간마다 돌리면 하루 24 × 5분 = 2시간이고, 그것은 방문마다
 * 바로 쓰던 지금(하루 0.93시간)보다 나쁘다. 자주 돌릴수록 손해다.
 *
 * 왜 이렇게까지 하는지는 `lib/website-visits.ts` 머리말에.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 하루치를 한 번에 넣는다. 평소 수십 건이라 순식간이지만 몰린 날을 위해 넉넉히 둔다
export const maxDuration = 60

/** 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 걸러 낸다. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  // Vercel 크론은 CRON_SECRET 이 있으면 Bearer 로 실어 보낸다.
  // 비밀이 없으면 열어 두지 않는다 — 아무나 부르면 Neon 을 원하는 때에 깨울 수 있다.
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 })
  }

  try {
    const { moved } = await flushVisits()
    console.log(`[visits] ${moved}건을 Postgres 로 옮겼다`)
    return NextResponse.json({ ok: true, moved })
  } catch (e) {
    // 실패해도 버퍼는 STAGING 에 남아 다음 크론이 다시 집는다. 잃지 않는다.
    console.error("[visits] 옮기기 실패 — 버퍼에 남겨 둔다", e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
