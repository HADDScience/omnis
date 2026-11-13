import { NextResponse } from "next/server"

import { requireAdminApi } from "@/lib/admin-access-server"
import { loadLoginCodeHistory } from "@/lib/admin-users-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 최근 30일 로그인 코드 기록 — 언제 · 누구에게 · 발송/로그인/틀림. 코드 값은 읽지도 않는다. 관리자만 */
export async function GET() {
  const a = await requireAdminApi()
  if ("fail" in a) return a.fail
  return NextResponse.json({ events: await loadLoginCodeHistory() }, { headers: { "Cache-Control": "no-store" } })
}
