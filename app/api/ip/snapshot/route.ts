import { NextRequest } from "next/server"

import { fetchSnapshot, loadPrefs } from "@/lib/ip-data"
import { authorize, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 화면 한 판에 필요한 것 전부 + 내 설정 + 내 역할.
 *
 * 여러 번 왕복하지 않고 한 번에 주는 이유: 자료가 백여 행뿐이라 나눠 받을 이유가
 * 없고, 화면이 여러 조각을 서로 다른 시점의 값으로 그리는 일이 생기지 않는다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response

  const [snapshot, prefs] = await Promise.all([
    fetchSnapshot(),
    loadPrefs(auth.caller.userId),
  ])

  return ok(
    {
      ...snapshot,
      prefs,
      me: {
        userId: auth.caller.membership.userId,
        email: auth.caller.membership.email,
        displayName: auth.caller.membership.displayName,
        role: auth.caller.membership.role,
      },
    },
    auth.cors
  )
}
