import { NextResponse } from "next/server"

import { requireAdminApi } from "@/lib/admin-access-server"
import { loadAdminUsers } from "@/lib/admin-users-server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** 계정 목록 — 메일은 가리고, 비밀번호 · 해시는 싣지 않는다(lib/admin-users.ts). 관리자만 */
export async function GET() {
  const a = await requireAdminApi()
  if ("fail" in a) return a.fail
  return NextResponse.json({ users: await loadAdminUsers() }, { headers: { "Cache-Control": "no-store" } })
}
