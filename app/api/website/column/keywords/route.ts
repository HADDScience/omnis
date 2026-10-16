import { NextRequest } from "next/server"

import { prisma } from "@/lib/db"
import { collectKeywords, scoreKeyword, SIMILAR_WARN } from "@/lib/column/collect"
import { isReviewer } from "@/lib/column/draft"
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
function startOfTodayKst(now = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000)
}

async function board(viewerId: string) {
  const [keywords, lastRun] = await Promise.all([
    prisma.columnKeyword.findMany({
      // 버린 키워드도 보낸다 — 보드의 「버림」 필터에서 되돌릴 수 있게
      select: {
        id: true, term: true, topic: true, summary: true, sources: true, timelyAt: true, status: true,
        reservedById: true, reservedAt: true, nearestPostId: true, nearestScore: true, createdAt: true,
        drafts: { select: { id: true, status: true, createdById: true, postId: true } },
      },
    }),
    prisma.columnKeywordRun.findFirst({ orderBy: { startedAt: "desc" } }),
  ])
  const ids = [...new Set(keywords.flatMap((k) => [k.reservedById, ...k.drafts.map((d) => d.createdById)]).filter((x): x is string => !!x))]
  const users = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const postIds = keywords.map((k) => k.nearestPostId).filter((x): x is string => !!x)
  const posts = new Map(
    (await prisma.websitePost.findMany({ where: { id: { in: postIds } }, select: { id: true, content: true } })).map((p) => [
      p.id,
      (p.content as { ko?: { title?: string } }).ko?.title ?? "",
    ])
  )
  const now = Date.now()
  const rows = keywords.map((k) => {
    const used = k.drafts.filter((d) => d.status === "published")
    const sources = Array.isArray(k.sources) ? k.sources : []
    const score = scoreKeyword({
      nearestScore: k.nearestScore,
      timelyAt: k.timelyAt,
      sourceCount: sources.length,
      usedCount: used.length,
      reservedByOther: k.status === "reserved" && k.reservedById !== viewerId,
      now,
    })
    return {
      ...k,
      reservedBy: k.reservedById ? (users.get(k.reservedById) ?? null) : null,
      nearestTitle: k.nearestPostId ? (posts.get(k.nearestPostId) ?? null) : null,
      usedCount: used.length,
      usedIn: used.map((d) => ({ postId: d.postId, by: users.get(d.createdById) ?? null })),
      drafts: k.drafts.map((d) => ({ id: d.id, status: d.status, by: users.get(d.createdById) ?? null })),
      similarWarn: (k.nearestScore ?? 0) >= SIMILAR_WARN,
      score,
    }
  })
  rows.sort((a, b) => b.score - a.score)
  const lastRunBy = lastRun ? (await prisma.user.findUnique({ where: { id: lastRun.createdById }, select: { name: true } }))?.name ?? null : null
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { id: true, name: true } })
  return {
    keywords: rows,
    lastRun: lastRun ? { ...lastRun, createdBy: lastRunBy } : null,
    me: viewer ? { ...viewer, isReviewer: isReviewer(viewer.name) } : null,
  }
}

export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error
  return websiteJson(await board(authed.user.id), 200, origin)
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin")
  const authed = await requireWebsiteUser(req)
  if ("error" in authed) return authed.error

  const today = await prisma.columnKeywordRun.findFirst({
    where: { startedAt: { gte: startOfTodayKst() } },
    orderBy: { startedAt: "desc" },
  })
  if (today) return websiteJson({ ...(await board(authed.user.id)), reused: true }, 200, origin)

  try {
    const result = await collectKeywords({ userId: authed.user.id })
    return websiteJson(
      { ...(await board(authed.user.id)), reused: false, run: { id: result.runId, items: result.items, results: result.results, dropped: result.dropped, durationMs: result.durationMs, cpuMs: result.cpuMs } },
      200,
      origin
    )
  } catch (e) {
    console.error("[column/keywords] 수집 실패", e)
    return websiteJson({ error: "collect_failed", message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
}
