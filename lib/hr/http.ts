// 지원서 입구(app/api/website/applications/**) 셋이 함께 쓰는 것 — 서버 간 비밀 확인 · 응답 모양. 계약: ~/work/omnis-reports/omnis-hr-api-contract-261124.md
import { NextResponse } from "next/server"
import { secretMatches } from "@/lib/hr/rules"

export function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  if (status === 204) return new NextResponse(null, { status, headers: { "cache-control": "no-store", ...headers } })
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } })
}

/**
 * 홈페이지 서버만 부른다(Bearer WEBSITE_CAREER_SECRET — 문의함 비밀과 다른 값).
 * 비밀이 없는 배포는 503 이다 — 공개 쓰기 입구가 되지 않게. 401 과 나누는 까닭은 문의함과 같다(홈페이지가 503 에 메일 되돌림을 띄운다).
 */
export function serverGate(req: Request): Response | null {
  const expected = process.env.WEBSITE_CAREER_SECRET
  if (!expected) return json({ error: "unavailable" }, 503)
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  if (!given || !secretMatches(given, expected)) return json({ error: "forbidden" }, 401)
  return null
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
