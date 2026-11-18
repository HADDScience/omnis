import { NextRequest } from "next/server"
import { z } from "zod"

import { keywordAction } from "@/lib/column/board"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/**
 * 키워드 하나에 대한 손질(POST). 누른 사람만 기록한다(2026-10-16 결정 — 로테이션 없음).
 * PATCH 가 아니라 POST 인 까닭: 관리 화면은 다른 오리진이라 CORS 를 지나는데, websiteCors 의
 * 허용 메서드에 PATCH 가 없다.
 *   reserve · release   다른 사람이 같은 키워드로 동시에 쓰지 않게 하는 표시
 *   discard · restore   보드에서 내리기 / 되돌리기
 *   removeSource        주제와 느슨하게 맞는 근거 기사를 사람이 뺀다
 */
export const dynamic = "force-dynamic"
export const OPTIONS = websiteOptions

type Props = { params: Promise<{ id: string }> }

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reserve") }),
  z.object({ action: z.literal("release") }),
  z.object({ action: z.literal("discard") }),
  z.object({ action: z.literal("restore") }),
  z.object({ action: z.literal("removeSource"), url: z.string().url() }),
])

export async function POST(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id } = await params
  const body = BodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return websiteJson({ error: "invalid_body" }, 400, origin)

  // 규칙은 lib/column/board.ts keywordAction(도구 column_keyword_action 와 같다)
  const r = await keywordAction(id, authed.user.id, body.data)
  if (!r.ok) return websiteJson({ error: r.error, ...(r.message ? { message: r.message } : {}) }, r.status, origin)
  return websiteJson({ ok: true }, 200, origin)
}
