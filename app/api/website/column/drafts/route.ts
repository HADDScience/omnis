import { NextRequest } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/db"
import { DraftError, generateDraft, isReviewer } from "@/lib/column/draft"
import { GeminiQuotaError } from "@/lib/gemini-usage"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/**
 * 칼럼 초안 목록과 생성.
 *   GET  — 초안 목록(최근 순). 게시된 것도 함께 — 사용 이력이다.
 *   POST — {keywordId} 로 초안 생성. 근거 기사를 읽고 Gemini 를 한 번 부른다(30~60초).
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120
export const OPTIONS = websiteOptions

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const drafts = await prisma.columnDraft.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, status: true, title: true, summary: true, postId: true, createdById: true, reviewerId: true,
      reviewNote: true, createdAt: true, updatedAt: true, keyword: { select: { id: true, term: true } },
    },
  })
  const ids = [...new Set(drafts.flatMap((d) => [d.createdById, d.reviewerId]).filter((x): x is string => !!x))]
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  return websiteJson(
    {
      me: { id: authed.user.id, name: authed.user.name, isReviewer: isReviewer(authed.user.name) },
      drafts: drafts.map((d) => ({ ...d, createdBy: names.get(d.createdById) ?? null, reviewer: d.reviewerId ? (names.get(d.reviewerId) ?? null) : null })),
    },
    200,
    origin
  )
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const body = z.object({ keywordId: z.string().min(1) }).safeParse(await req.json().catch(() => null))
  if (!body.success) return websiteJson({ error: "invalid_body" }, 400, origin)
  try {
    const result = await generateDraft(body.data.keywordId, authed.user.id)
    return websiteJson(result, 201, origin)
  } catch (e) {
    if (e instanceof DraftError) return websiteJson({ error: e.code, message: e.message }, e.status, origin)
    if (e instanceof GeminiQuotaError) return websiteJson({ error: "gemini_quota", message: e.userMessage }, 429, origin)
    console.error("[column/drafts] 초안 생성 실패", e)
    return websiteJson({ error: "draft_failed", message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
}
