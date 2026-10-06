import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { proposeRecordsFromChat } from "@/lib/record-proposals"

/**
 * 어제 하루치 채팅에서 연혁 후보를 찾는다. 하루 한 번(`vercel.json` 의 crons).
 *
 * 방문 기록 옮기기(flush-visits, 19:00 UTC) 10분 뒤에 돈다 — Neon 은 마지막 질의 5분 뒤에 자므로
 * 따로 깨우지 않으려고 붙여 둔다. 업무 스레드는 업무가 끝날 때 따로 한 번 더 본다(task_done).
 * 같은 사건이 두 번 걸려도 날짜 ±7일 + 제목 대조로 한 번만 올라간다.
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// 하루치 대화를 300개씩 나눠 Gemini 에 보낸다. 많은 날도 두세 번이면 끝난다
export const maxDuration = 300

function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: "unavailable" }, { status: 503 })

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 })
  }

  // 26시간 — 크론이 몇 분 늦게 돌아도 틈이 생기지 않게 겹쳐 본다. 겹친 부분은 중복 대조가 거른다
  const until = new Date()
  const since = new Date(until.getTime() - 26 * 3600_000)
  try {
    const r = await proposeRecordsFromChat(since, until)
    console.log(`[record-proposals] 대화 ${r.messages}건 → 제안 ${r.created}건`, r.skipped)
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    console.error("[record-proposals] 크론 실패", e)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
