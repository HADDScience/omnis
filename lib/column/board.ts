// 칼럼 키워드 보드 · 키워드 예약/버리기 · 오늘 수집 · 초안 목록 — 홈페이지 관리 화면(app/api/website/column/*)과
// 도구(lib/tools/plan-website.ts)가 같이 부른다(#248). 라우트 안에 있던 것을 그대로 옮겼다.
import { prisma } from "@/lib/db"
import { scoreKeyword, SIMILAR_WARN, type KeywordSource } from "@/lib/column/collect"
import { isReviewer, reviewProblems } from "@/lib/column/draft"

export function startOfTodayKst(now = new Date()): Date {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600_000)
}

export async function keywordBoard(viewerId: string) {
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


/** 오늘(KST) 이미 돈 수집 — 하루 한 번만 돈다 */
export function todaysKeywordRun() {
  return prisma.columnKeywordRun.findFirst({ where: { startedAt: { gte: startOfTodayKst() } }, orderBy: { startedAt: "desc" } })
}

export type KeywordAction = { action: "reserve" } | { action: "release" } | { action: "discard" } | { action: "restore" } | { action: "removeSource"; url: string }
export type KeywordActionResult = { ok: true } | { ok: false; status: number; error: string; message?: string }

/** 키워드 예약 · 풀기 · 버리기 · 되살리기 · 근거 빼기 — 예약 중이면 예약한 사람만 풀고 버린다 */
export async function keywordAction(id: string, me: string, body: KeywordAction): Promise<KeywordActionResult> {
  const k = await prisma.columnKeyword.findUnique({ where: { id }, include: { drafts: { select: { id: true } } } })
  if (!k) return { ok: false, status: 404, error: "not_found" }
  const busyByOther = k.status === "reserved" && k.reservedById !== null && k.reservedById !== me
  switch (body.action) {
    case "reserve":
      if (k.status !== "candidate") return { ok: false, status: 409, error: "bad_state", message: "후보 상태의 키워드만 예약할 수 있습니다" }
      await prisma.columnKeyword.update({ where: { id }, data: { status: "reserved", reservedById: me, reservedAt: new Date() } })
      break
    case "release":
      if (k.status !== "reserved") return { ok: false, status: 409, error: "bad_state" }
      if (busyByOther) return { ok: false, status: 409, error: "reserved_by_other", message: "다른 사람이 예약했습니다" }
      if (k.drafts.length) return { ok: false, status: 409, error: "has_drafts", message: "초안이 있는 키워드는 초안을 지워야 예약이 풀립니다" }
      await prisma.columnKeyword.update({ where: { id }, data: { status: "candidate", reservedById: null, reservedAt: null } })
      break
    case "discard":
      if (busyByOther || k.drafts.length) return { ok: false, status: 409, error: "in_use", message: "예약됐거나 초안이 있는 키워드는 버릴 수 없습니다" }
      await prisma.columnKeyword.update({ where: { id }, data: { status: "discarded", reservedById: null, reservedAt: null } })
      break
    case "restore":
      if (k.status !== "discarded") return { ok: false, status: 409, error: "bad_state" }
      await prisma.columnKeyword.update({ where: { id }, data: { status: "candidate" } })
      break
    case "removeSource": {
      const sources = (Array.isArray(k.sources) ? k.sources : []) as unknown as KeywordSource[]
      const next = sources.filter((s) => s.url !== body.url)
      if (next.length === sources.length) return { ok: false, status: 404, error: "not_found", message: "그 근거가 없습니다" }
      if (!next.length) return { ok: false, status: 409, error: "last_source", message: "근거가 하나뿐이면 뺄 수 없습니다 — 키워드를 버려 주세요" }
      const dates = next.map((s) => s.date).filter((d): d is string => !!d).sort()
      await prisma.columnKeyword.update({ where: { id }, data: { sources: next as object, timelyAt: dates.length ? new Date(dates.at(-1) as string) : null } })
      break
    }
  }
  return { ok: true }
}

/** 초안 목록(최근 순, 게시된 것 포함) */
export async function listColumnDrafts() {
  const drafts = await prisma.columnDraft.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, status: true, title: true, summary: true, postId: true, createdById: true, reviewerId: true,
      reviewNote: true, createdAt: true, updatedAt: true, keyword: { select: { id: true, term: true } },
    },
  })
  const ids = [...new Set(drafts.flatMap((d) => [d.createdById, d.reviewerId]).filter((x): x is string => !!x))]
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  return drafts.map((d) => ({ ...d, createdBy: names.get(d.createdById) ?? null, reviewer: d.reviewerId ? (names.get(d.reviewerId) ?? null) : null }))
}

/** 초안 하나 + 검토 문제 목록 */
export async function columnDraftView(id: string) {
  const d = await prisma.columnDraft.findUnique({ where: { id }, include: { keyword: { select: { id: true, term: true, summary: true, sources: true } } } })
  if (!d) return null
  const ids = [d.createdById, d.reviewerId].filter((x): x is string => !!x)
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  return {
    draft: { ...d, createdBy: names.get(d.createdById) ?? null, reviewer: d.reviewerId ? (names.get(d.reviewerId) ?? null) : null },
    problems: reviewProblems(d),
  }
}

export { isReviewer }
