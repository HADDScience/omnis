import { NextRequest } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { DraftError, discardDraft, isReviewer, reviewProblems, updateDraft } from "@/lib/column/draft"
import { PostBlockSchema } from "@/lib/schemas/website"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/** 초안 하나 — 읽기 · 고치기(초안·수정 요청 상태에서만) · 버리기(게시 전만). */
export const dynamic = "force-dynamic"
export const OPTIONS = websiteOptions

type Props = { params: Promise<{ id: string }> }

const fail = (e: unknown, origin: string | null) => {
  if (e instanceof DraftError) return websiteJson({ error: e.code, message: e.message }, e.status, origin)
  throw e
}

export async function GET(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id } = await params
  const d = await prisma.columnDraft.findUnique({ where: { id }, include: { keyword: { select: { id: true, term: true, summary: true, sources: true } } } })
  if (!d) return websiteJson({ error: "not_found" }, 404, origin)
  const ids = [d.createdById, d.reviewerId].filter((x): x is string => !!x)
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  return websiteJson(
    {
      draft: { ...d, createdBy: names.get(d.createdById) ?? null, reviewer: d.reviewerId ? (names.get(d.reviewerId) ?? null) : null },
      problems: reviewProblems(d),
      me: { id: authed.user.id, name: authed.user.name, isReviewer: isReviewer(authed.user.name) },
    },
    200,
    origin
  )
}

const PutSchema = z.object({ title: z.string().max(2_000), summary: z.string().max(2_000), blocks: z.array(PostBlockSchema).max(500) })

export async function PUT(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id } = await params
  const body = PutSchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return websiteJson({ error: "invalid_body", issues: body.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400, origin)
  }
  try {
    const d = await updateDraft(id, body.data)
    return websiteJson({ draft: d, problems: reviewProblems(d) }, 200, origin)
  } catch (e) {
    return fail(e, origin)
  }
}

export async function DELETE(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id } = await params
  try {
    await discardDraft(id)
    return websiteJson({ ok: true }, 200, origin)
  } catch (e) {
    return fail(e, origin)
  }
}
