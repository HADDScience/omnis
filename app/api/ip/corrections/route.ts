import { NextRequest } from "next/server"

import { correctRecord, type Correction, type EntityKind } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 값 정정.
 *
 * 대장을 직접 찌르지 않고 진행 기록 한 줄(source='edit')로 남긴다. 그러면 무엇이
 * 언제 왜 바뀌었는지가 이력에 남고, 대장은 여전히 기록의 결과로만 바뀐다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{
    entityKind: EntityKind
    entityId: string
    stage: string
    today: string
    patch: Correction
    reason: string
  }>(req)
  if (!input?.entityKind || !input.entityId || !input.today) {
    return bad("entityKind·entityId·today 가 필요합니다", auth.cors)
  }

  await correctRecord(
    auth.caller.userId,
    input.entityKind,
    input.entityId,
    input.stage,
    input.today,
    input.patch ?? {},
    input.reason ?? ""
  )
  return ok({ ok: true }, auth.cors)
}
