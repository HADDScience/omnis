import { NextRequest } from "next/server"

import {
  removeProgress,
  saveProgress,
  setNextTurn,
  setTurnAndDue,
  type ProgressInput,
  type NextTurn,
} from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * 진행 기록. 대장(상표·특허) 반영은 여기서 하지 않는다 —
 * DB 트리거(ip.apply_progress_entry)가 한다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ entry: ProgressInput; isNew: boolean }>(req)
  if (!input?.entry) return bad("entry 가 없습니다", auth.cors)

  await saveProgress(auth.caller.userId, input.entry, Boolean(input.isNew))
  return ok({ ok: true }, auth.cors)
}

export async function PATCH(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ id: string; nextTurn: NextTurn; dueOn?: string | null }>(req)
  if (!input?.id || !input.nextTurn) return bad("id 와 nextTurn 이 필요합니다", auth.cors)

  // dueOn 이 아예 없으면 차례만 넘기는 것이다. null 은 "기한 없음"이라 다르다.
  if (input.dueOn === undefined) {
    await setNextTurn(auth.caller.userId, input.id, input.nextTurn)
  } else {
    await setTurnAndDue(auth.caller.userId, input.id, input.nextTurn, input.dueOn)
  }
  return ok({ ok: true }, auth.cors)
}

export async function DELETE(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return bad("id 가 필요합니다", auth.cors)

  await removeProgress(auth.caller.userId, id)
  return ok({ ok: true }, auth.cors)
}
