import { NextRequest } from "next/server"

import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { bufferStatus, visitStats } from "@/lib/website-visits"

/**
 * 방문 통계 — 관리 화면이 읽는다. 로그인한 구성원만 본다.
 *
 * `?days=7|30|90` (기본 30). 하루 경계는 KST 다.
 *
 * `pending` 은 아직 Postgres 로 넘어가지 않아 **아래 숫자에 들어 있지 않은** 방문 수다.
 * 방문은 Redis 에 쌓였다가 새벽 4시(KST) 크론이 한 번에 옮긴다 — Neon 을 방문마다
 * 깨우지 않기 위해서다(`lib/website-visits.ts` 머리말). 화면은 이 수를 사람에게 알려야
 * 「오늘 0명」 을 장애로 오해하지 않는다.
 *
 * `bufferOk` 가 false 면 **버퍼가 고장 났다는 뜻**이다. 방문은 Postgres 로 직행하므로
 * 숫자는 맞지만 Neon 을 방문마다 깨우는 옛 상태로 돌아간 것이다. 화면이 경고를 띄워야
 * 사람이 알아챈다 — 이 값이 없으면 아무 표시도 없이 요금만 오른다.
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

  const [stats, buf] = await Promise.all([visitStats(days), bufferStatus()])
  return websiteJson({ ...stats, pending: buf.pending, bufferOk: buf.ok }, 200, origin)
}
