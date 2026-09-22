import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { recordVisit, visitIntakeSchema } from "@/lib/website-visits"

/**
 * 홈페이지 방문 한 건을 받는다.
 *
 * **서버 간 호출이다.** 사이트의 `app/api/hit/route.ts` 가 공유 비밀을 들고 부른다.
 * 브라우저를 여기에 직접 붙이지 않는다 — 주소가 공개되면 봇이 사이트를 거치지 않고
 * 숫자를 부풀린다. 그래서 CORS 를 주지 않는다. 같은 `/api/website/` 아래여도
 * 관리 화면이 읽는 posts·stats(브라우저 · SSO Bearer)와 성격이 다르다.
 *
 * 계약의 정본: mydocs/plans/2026-09-22-website-visit-stats.md
 */

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } })
}

/** 길이가 다르면 timingSafeEqual 이 던진다 — 먼저 걸러 낸다. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: Request) {
  // 비밀을 빠뜨린 배포가 공개 쓰기 엔드포인트가 되지 않게 한다.
  const expected = process.env.WEBSITE_VISIT_SECRET
  if (!expected) return json({ error: "unavailable" }, 503)

  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) return json({ error: "forbidden" }, 401)

  const parsed = visitIntakeSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: "invalid_visit" }, 400)

  try {
    await recordVisit(parsed.data)
  } catch {
    // 통계를 적다 실패했다고 사이트가 느려지거나 오류를 띄울 이유가 없다.
    // 부르는 쪽은 응답을 기다리지도 않는다(sendBeacon). 한 건을 잃고 넘어간다.
    return json({ ok: false }, 202)
  }
  return json({ ok: true }, 202)
}
