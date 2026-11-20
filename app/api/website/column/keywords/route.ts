import { NextRequest } from "next/server"

import { collectKeywords } from "@/lib/column/collect"
import { keywordBoard, todaysKeywordRun } from "@/lib/column/board"
import { GeminiQuotaError } from "@/lib/gemini-usage"
import { requireWebsiteUser, websiteJson, websiteOptions } from "@/lib/website-auth"

/**
 * 칼럼 키워드 보드.
 *   GET  — 후보 목록(추천순) + 마지막 수집 실행
 *   POST — 후보 수집 실행. 한도(Vercel Hobby, 팀 공용) 때문에 하루 한 번만 돈다 —
 *          같은 날 다시 누르면 새로 돌리지 않고 그날 결과를 돌려준다.
 *
 * 설계: mydocs/plans/2026-10-16-column-keyword-pipeline.md
 */
export const dynamic = "force-dynamic"
/** 피드 열댓 개 + Gemini 1회 + 임베딩. 실측 1~2분 예상, 여유를 둔다 */
export const maxDuration = 300

export const OPTIONS = websiteOptions

/** KST 자정. 「하루 한 번」 의 하루 */
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  return websiteJson(await keywordBoard(authed.user.id), 200, origin)
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  // 하루 한 번 — 오늘 돈 수집이 있으면 그 결과(lib/column/board.ts, 도구 collect_column_keywords 와 같다)
  const today = await todaysKeywordRun()
  if (today) return websiteJson({ ...(await keywordBoard(authed.user.id)), reused: true }, 200, origin)

  try {
    const result = await collectKeywords({ userId: authed.user.id })
    return websiteJson(
      { ...(await keywordBoard(authed.user.id)), reused: false, run: { id: result.runId, items: result.items, results: result.results, dropped: result.dropped, durationMs: result.durationMs, cpuMs: result.cpuMs } },
      200,
      origin
    )
  } catch (e) {
    if (e instanceof GeminiQuotaError) return websiteJson({ error: "gemini_quota", message: e.userMessage }, 429, origin)
    console.error("[column/keywords] 수집 실패", e)
    return websiteJson({ error: "collect_failed", message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
}
