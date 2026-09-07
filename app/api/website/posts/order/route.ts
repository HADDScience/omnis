import { NextRequest } from "next/server"

import { OrderInputSchema } from "@/lib/schemas/website"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { reorderPosts, revalidateWebsite } from "@/lib/website-posts"

/** 목록 순서. id 배열을 받아 position 을 다시 매긴다. */
export const dynamic = "force-dynamic"

export const OPTIONS = websiteOptions

export async function PUT(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const body = OrderInputSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) return websiteJson({ error: "invalid_order" }, 400, origin)

  await reorderPosts(body.data.order)
  await revalidateWebsite()
  return websiteJson({ ok: true }, 200, origin)
}
