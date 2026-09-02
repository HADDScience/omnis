import { NextRequest } from "next/server"

import { isDeletable, removeEntity, undoDelete } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 삭제와 되돌리기.
 *
 * 표 이름이 SQL 에 그대로 들어가므로 반드시 화이트리스트(isDeletable)를 지난다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function DELETE(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const url = new URL(req.url)
  const entity = url.searchParams.get("entity") ?? ""
  const id = url.searchParams.get("id")
  if (!isDeletable(entity)) return bad("지울 수 없는 표입니다", auth.cors)
  if (!id) return bad("id 가 필요합니다", auth.cors)

  await removeEntity(auth.caller.userId, entity, id)
  return ok({ ok: true }, auth.cors)
}

/** 삭제 직전 상태를 audit_log 에서 찾아 되돌린다. */
export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ entity: string; id: string }>(req)
  if (!input || !isDeletable(input.entity)) return bad("지울 수 없는 표입니다", auth.cors)
  if (!input.id) return bad("id 가 필요합니다", auth.cors)

  try {
    await undoDelete(auth.caller.userId, input.entity, input.id)
    return ok({ ok: true }, auth.cors)
  } catch (err) {
    return bad((err as Error).message, auth.cors, 404)
  }
}
