import { NextRequest } from "next/server"

import { saveCommunication, type Communication } from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/** 연락 기록. 연결(어느 건에 걸리는지)까지 한 트랜잭션에서 갈아끼운다. */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{ communication: Communication; isNew: boolean }>(req)
  if (!input?.communication) return bad("communication 이 없습니다", auth.cors)

  const id = await saveCommunication(
    auth.caller.userId,
    input.communication,
    Boolean(input.isNew)
  )
  return ok({ id }, auth.cors)
}
