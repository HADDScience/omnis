import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"

import { apiError, parseJson } from "@/lib/api"
import { requireAdminApi } from "@/lib/admin-access-server"
import { setOnboardingFor } from "@/lib/admin-users-server"

export const runtime = "nodejs"

const Body = z.object({ action: z.enum(["replay", "dismiss"]), userIds: z.array(z.string().min(1).max(64)).min(1).max(200) }).strict()

/** 사람별 온보딩 — 다시 띄우기(replay) · 끄기(dismiss). 여러 명 한꺼번에. 관리자만, 사람마다 감사 기록 */
export async function POST(req: NextRequest) {
  const a = await requireAdminApi()
  if ("fail" in a) return a.fail
  const parsed = Body.safeParse(await parseJson(req))
  if (!parsed.success) return apiError(400, "action(replay · dismiss) 과 userIds 가 필요합니다")
  const result = await setOnboardingFor(a.userId, parsed.data.userIds, parsed.data.action)
  if (result.names.length === 0) return apiError(404, "바꿀 계정이 없습니다")
  return NextResponse.json(result)
}
