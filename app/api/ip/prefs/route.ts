import { NextRequest } from "next/server"

import { loadPrefs, markTutorialSeen, saveStageOrder, type StageOrder } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 개인 설정. 자기 것만 읽고 쓴다 — userId 를 본문이 아니라 토큰에서 가져오므로
 * 남의 설정은 건드릴 수 없다.
 *
 * viewer 도 자기 화면 설정은 바꿀 수 있어야 하므로 write 게이트를 걸지 않는다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response
  return ok(await loadPrefs(auth.caller.userId), auth.cors)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response

  const input = await body<{ stageOrder?: StageOrder; tutorialSeen?: boolean }>(req)
  if (!input) return bad("본문이 필요합니다", auth.cors)

  if (input.stageOrder) await saveStageOrder(auth.caller.userId, input.stageOrder)
  if (input.tutorialSeen) await markTutorialSeen(auth.caller.userId)
  return ok({ ok: true }, auth.cors)
}
