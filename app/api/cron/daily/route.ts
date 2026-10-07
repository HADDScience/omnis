import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { flushVisits } from "@/lib/website-visits"
import { proposeRecordsFromChat } from "@/lib/record-proposals"

/**
 * 하루 한 번 도는 일을 모두 여기서 차례로 한다 (`vercel.json` 의 crons 는 이것 하나).
 *
 * **크론을 하나로 두는 것이 핵심이다.** Neon 은 마지막 질의 5분 뒤에 자고, 한 번 깨면 최소 5분이 든다.
 * 크론이 둘이면 하루 두 번 깨운다. 시각을 붙여 두어도 소용없다 — Hobby 크론은 지정한 시(hour) 안
 * 아무 때나 돌아서 둘 사이가 5분을 넘길 수 있다. 그래서 한 번 깨운 김에 다 한다.
 * (2026-10-06, 연혁 후보 크론을 따로 두려다 고쳤다 — mydocs/working/2026-09-28-neon-wake-time.md)
 *
 * 일 하나가 실패해도 다음 일은 한다. 각자 다음 날 다시 집으니 잃는 것이 없다.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 방문 기록은 순식간이고, 연혁 후보는 하루치 대화를 300개씩 Gemini 에 보낸다(평소 한 번 · 약 10초)
export const maxDuration = 300

/** 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 걸러 낸다. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  // Vercel 크론은 CRON_SECRET 이 있으면 Bearer 로 실어 보낸다. 비밀이 없으면 열어 두지 않는다.
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 })
  }

  const out: Record<string, unknown> = {}

  try {
    const { moved } = await flushVisits()
    console.log(`[cron/daily] 방문 ${moved}건을 Postgres 로 옮겼다`)
    out.visits = { ok: true, moved }
  } catch (e) {
    // 버퍼는 STAGING 에 남아 다음 날 다시 집는다
    console.error("[cron/daily] 방문 옮기기 실패 — 버퍼에 남겨 둔다", e)
    out.visits = { ok: false }
  }

  try {
    // 26시간 — 크론이 시(hour) 안 어디서 돌든 틈이 생기지 않게 겹쳐 본다. 겹친 부분은 중복 대조가 거른다
    const until = new Date()
    const r = await proposeRecordsFromChat(new Date(until.getTime() - 26 * 3600_000), until)
    console.log(`[cron/daily] 연혁 후보 — 대화 ${r.messages}건 → 제안 ${r.created}건`, r.skipped)
    out.records = { ok: true, ...r }
  } catch (e) {
    console.error("[cron/daily] 연혁 후보 실패", e)
    out.records = { ok: false }
  }

  const ok = Object.values(out).every((v) => (v as { ok: boolean }).ok)
  return NextResponse.json({ ok, ...out }, { status: ok ? 200 : 500 })
}
