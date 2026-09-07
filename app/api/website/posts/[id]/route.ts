import { NextRequest, NextResponse } from "next/server"

import { PostIdSchema, PostInputSchema } from "@/lib/schemas/website"
import { requireWebsiteUser, websiteCors, websiteJson, websiteOptions } from "@/lib/website-auth"
import { deletePost, getPost, revalidateWebsite, savePost } from "@/lib/website-posts"

/**
 * 기사 한 건. GET 은 공개, PUT(upsert) · DELETE 는 관리 화면(SSO).
 * 잘못된 본문은 Zod 가 400 으로 막는다 — 사이트가 그리지 못하는 글이 저장되면 안 된다.
 */
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export const OPTIONS = websiteOptions

export async function GET(req: NextRequest, { params }: Props) {
  const { id } = await params
  const post = await getPost(id)
  if (!post) return websiteJson({ error: "not_found" }, 404, req.headers.get("origin"))
  return NextResponse.json(post, {
    headers: {
      ...websiteCors(req.headers.get("origin")),
      "cache-control": "public, s-maxage=60, stale-while-revalidate=60",
    },
  })
}

export async function PUT(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const { id } = await params
  if (!PostIdSchema.safeParse(id).success) return websiteJson({ error: "bad_id" }, 400, origin)

  const body = PostInputSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return websiteJson(
      { error: "invalid_post", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      400,
      origin
    )
  }
  if (!body.data.content[body.data.sourceLang]) {
    return websiteJson({ error: "invalid_post", issues: ["원문 언어의 내용이 없습니다"] }, 400, origin)
  }

  const result = await savePost(id, body.data, authed.user.id)
  await revalidateWebsite()
  return websiteJson(result, 200, origin)
}

export async function DELETE(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const { id } = await params
  const removed = await deletePost(id)
  if (!removed) return websiteJson({ error: "not_found" }, 404, origin)
  await revalidateWebsite()
  return websiteJson({ ok: true }, 200, origin)
}
