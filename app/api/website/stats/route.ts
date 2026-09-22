import { NextRequest } from "next/server"

import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { visitStats } from "@/lib/website-visits"

/**
 * 방문 통계 — 관리 화면이 읽는다. 로그인한 구성원만 본다.
 *
 * `?days=7|30|90` (기본 30). 하루 경계는 KST 다.
 */
export const dynamic = "force-dynamic"

export const OPTIONS = websiteOptions

const ALLOWED_DAYS = [7, 30, 90]

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  // 임의의 기간을 허용하면 표 전체를 훑는 질의를 아무나 반복해서 부를 수 있다.
  const asked = Number(req.nextUrl.searchParams.get("days") ?? 30)
  const days = ALLOWED_DAYS.includes(asked) ? asked : 30

  return websiteJson(await visitStats(days), 200, origin)
}
