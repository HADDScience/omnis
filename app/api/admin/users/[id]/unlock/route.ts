import { NextResponse } from "next/server"

import { apiError } from "@/lib/api"
import { requireAdminApi } from "@/lib/admin-access-server"
import { unlockLogin } from "@/lib/admin-users-server"

export const runtime = "nodejs"

/** 로그인 잠금 해제 — 실패 수를 0 으로 되돌리고 감사 기록을 남긴다(lib/admin-users-server.ts). 관리자만 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireAdminApi()
  if ("fail" in a) return a.fail
  const { id } = await params
  const result = await unlockLogin(a.userId, id)
  if (!result.ok) return apiError(result.reason === "not_found" ? 404 : 409, result.reason === "not_found" ? "없는 계정입니다" : "잠겨 있지 않습니다")
  return NextResponse.json({ ok: true })
}
