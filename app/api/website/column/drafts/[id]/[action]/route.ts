import { NextRequest } from "next/server"
import { z } from "zod"

import { DraftError, decide, publishDraft, requestReview } from "@/lib/column/draft"
import { GeminiQuotaError } from "@/lib/gemini-usage"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/**
 * 초안 상태 전이.
 *   POST …/review   검토 요청 → 대표님께 Omnis 알림
 *   POST …/decide   {decision: approve | request_changes, note?} — 대표님만
 *   POST …/publish  승인된 초안을 라이브러리 글로 저장(영문 자동 번역 포함)
 */
export const dynamic = "force-dynamic"
/** publish 는 savePost 안에서 번역이 돈다 */
export const maxDuration = 120
export const OPTIONS = websiteOptions

type Props = { params: Promise<{ id: string; action: string }> }

const DecideSchema = z.object({ decision: z.enum(["approve", "request_changes"]), note: z.string().max(2_000).optional() })

export async function POST(req: NextRequest, { params }: Props) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  const { id, action } = await params
  try {
    if (action === "review") return websiteJson({ draft: await requestReview(id, authed.user) }, 200, origin)
    if (action === "decide") {
      const body = DecideSchema.safeParse(await req.json().catch(() => null))
      if (!body.success) return websiteJson({ error: "invalid_body" }, 400, origin)
      return websiteJson({ draft: await decide(id, authed.user, body.data.decision, body.data.note) }, 200, origin)
    }
    if (action === "publish") return websiteJson(await publishDraft(id, authed.user.id), 200, origin)
    return websiteJson({ error: "not_found" }, 404, origin)
  } catch (e) {
    if (e instanceof DraftError) return websiteJson({ error: e.code, message: e.message }, e.status, origin)
    if (e instanceof GeminiQuotaError) return websiteJson({ error: "gemini_quota", message: e.userMessage }, 429, origin)
    console.error(`[column/drafts/${action}]`, e)
    return websiteJson({ error: "failed", message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
}
