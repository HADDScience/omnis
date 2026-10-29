import { NextRequest } from "next/server"

import {
  createCase,
  savePatent,
  saveTrademark,
  type EntityKind,
  type Patent,
  type Trademark,
} from "@/lib/ip-data"
import { authorize, bad, body, isDenied, ok, preflight } from "@/lib/ip-api"

/** 상표·특허 대장. */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

/** 새 건 만들기. 번호 매기기와 출발선 생성은 ip.create_case 가 한다. */
export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  // status 가 새 이름이다. 옛 화면은 stage 에 옛 단계(아이디어…)를 보낸다 — create_case 가 상태로 옮긴다.
  const input = await body<{
    kind: EntityKind
    name: string
    status?: string
    stage?: string
    note?: string
  }>(req)
  if (!input?.kind || !input.name) {
    return bad("kind·name 이 필요합니다", auth.cors)
  }

  try {
    const id = await createCase(
      auth.caller.userId,
      input.kind,
      input.name,
      input.status ?? input.stage ?? "출원전",
      input.note ?? ""
    )
    return ok({ id }, auth.cors)
  } catch (err) {
    // create_case 는 알 수 없는 상태·빈 이름을 raise 로 막는다. 그 문장을 그대로 보낸다.
    return bad((err as Error).message, auth.cors, 422)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await authorize(req, { write: true })
  if (isDenied(auth)) return auth.response

  const input = await body<{
    kind: EntityKind
    isNew: boolean
    trademark?: Trademark
    patent?: Patent
  }>(req)
  if (!input?.kind) return bad("kind 가 필요합니다", auth.cors)

  if (input.kind === "trademark") {
    if (!input.trademark) return bad("trademark 가 없습니다", auth.cors)
    await saveTrademark(auth.caller.userId, input.trademark, Boolean(input.isNew))
  } else {
    if (!input.patent) return bad("patent 가 없습니다", auth.cors)
    await savePatent(auth.caller.userId, input.patent, Boolean(input.isNew))
  }
  return ok({ ok: true }, auth.cors)
}
