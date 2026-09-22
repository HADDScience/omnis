import { NextRequest } from "next/server"

import { PinInputSchema, PostIdSchema } from "@/lib/schemas/website"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { revalidateWebsite, setPinned } from "@/lib/website-posts"

/**
 * 고정 토글. 관리 화면의 압정 버튼 하나가 부른다.
 *
 * 기사 PUT 과 나누어 둔 이유는 `setPinned` 주석에 있다 — 본문을 다시 쓰지 않기 위해서다.
 */
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export const OPTIONS = websiteOptions

export async function PUT(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const { id } = await params
  if (!PostIdSchema.safeParse(id).success) return websiteJson({ error: "bad_id" }, 400, origin)

  const body = PinInputSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return websiteJson({ error: "invalid_pin" }, 400, origin)

  const pinned = await setPinned(id, body.data.pinned, authed.user.id)
  if (pinned === null) return websiteJson({ error: "not_found" }, 404, origin)

  await revalidateWebsite()
  return websiteJson({ ok: true, pinned }, 200, origin)
}
