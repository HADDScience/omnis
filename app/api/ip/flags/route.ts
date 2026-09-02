import { NextRequest } from "next/server"

import { addFlag, setFlagState } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/** 자료 불일치 경고. 사람이 확인하고 닫는다. */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ entityKind: string; entityId: string | null; message: string }>(req)
  if (!input?.entityKind || !input.message) {
    return bad("entityKind 와 message 가 필요합니다", auth.cors)
  }

  await addFlag(auth.caller.userId, input.entityKind, input.entityId ?? null, input.message)
  return ok({ ok: true }, auth.cors)
}

export async function PATCH(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ id: string; state: string; resolution: string | null }>(req)
  if (!input?.id || !input.state) return bad("id 와 state 가 필요합니다", auth.cors)

  await setFlagState(auth.caller.userId, input.id, input.state, input.resolution ?? null)
  return ok({ ok: true }, auth.cors)
}
