import { NextRequest } from "next/server"

import { saveAction, setActionState, type ActionItem } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/** 미결 액션. */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ action: ActionItem; isNew: boolean }>(req)
  if (!input?.action) return bad("action 이 없습니다", auth.cors)

  await saveAction(auth.caller.userId, input.action, Boolean(input.isNew))
  return ok({ ok: true }, auth.cors)
}

export async function PATCH(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ id: string; state: string; resolution: string | null }>(req)
  if (!input?.id || !input.state) return bad("id 와 state 가 필요합니다", auth.cors)

  await setActionState(auth.caller.userId, input.id, input.state, input.resolution ?? null)
  return ok({ ok: true }, auth.cors)
}
