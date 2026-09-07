import { NextRequest } from "next/server"

import { PostIdSchema } from "@/lib/schemas/website"
import { MAX_UPLOAD_BYTES } from "@/lib/storage"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"
import { extensionFor, storeMedia } from "@/lib/website-media"

/**
 * 사진 업로드. 본문이 곧 바이트다(multipart 아님 — 관리 화면이 이미 webp 로 줄여 보낸다).
 * 헤더 `x-post-id` 로 어느 기사의 사진인지, `content-type` 으로 형식을 받는다.
 * 기사 행이 아직 없어도 된다 — 새 글은 사진을 먼저 올리고 글을 저장한다. 그래서 WebsiteMedia 의
 * postId 는 외래키가 아니고, 끝내 저장되지 않은 글의 사진은 정리 작업이 거둬 가게 둔다.
 */
export const dynamic = "force-dynamic"

export const OPTIONS = websiteOptions

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const postId = req.headers.get("x-post-id") ?? ""
  if (!PostIdSchema.safeParse(postId).success) return websiteJson({ error: "bad_post_id" }, 400, origin)

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim()
  if (!extensionFor(contentType)) return websiteJson({ error: "unsupported_type" }, 415, origin)

  const declared = Number(req.headers.get("content-length") ?? 0)
  if (declared > MAX_UPLOAD_BYTES) return websiteJson({ error: "too_large" }, 413, origin)
  const bytes = Buffer.from(await req.arrayBuffer())
  if (bytes.length === 0) return websiteJson({ error: "empty" }, 400, origin)
  if (bytes.length > MAX_UPLOAD_BYTES) return websiteJson({ error: "too_large" }, 413, origin)

  const stored = await storeMedia({ postId, bytes, contentType })
  return websiteJson({ url: stored.url }, 201, origin)
}
