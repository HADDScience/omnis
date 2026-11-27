// 과제 후보 · 우리 결정 찾기 조건 — 화면(아카이브 › 국가과제)과 도구(search_grant_notices · list_grant_decisions)가 같이 쓴다.
import type { Prisma } from "@/generated/prisma/client"
import {
  DEADLINE_FILTERS,
  GRANT_STAGES,
  REGION_GROUPS,
  VERDICTS,
  type DeadlineFilter,
  type RegionGroup,
  type Verdict,
  type GrantStage,
} from "@/lib/grants-labels"

const DAY = 86_400_000

export interface NoticeFilter {
  verdicts: Verdict[]
  deadline: DeadlineFilter
  region: RegionGroup | null
  query: string
  profile: "sole" | "corp"
}

/** 화면 주소 · 도구 인자를 한 모양으로. 모르는 값은 기본으로 */
export function readNoticeFilter(raw: {
  verdict?: unknown
  deadline?: unknown
  region?: unknown
  query?: unknown
  profile?: unknown
}): NoticeFilter {
  const v =
    typeof raw.verdict === "string"
      ? raw.verdict
          .split(",")
          .filter((x): x is Verdict =>
            (VERDICTS as readonly string[]).includes(x)
          )
      : []
  return {
    verdicts: v.length ? v : ["해당", "애매"],
    deadline:
      typeof raw.deadline === "string" && raw.deadline in DEADLINE_FILTERS
        ? (raw.deadline as DeadlineFilter)
        : "open",
    region:
      typeof raw.region === "string" && raw.region in REGION_GROUPS
        ? (raw.region as RegionGroup)
        : null,
    query: typeof raw.query === "string" ? raw.query.trim().slice(0, 100) : "",
    profile: raw.profile === "corp" ? "corp" : "sole",
  }
}

/**
 * 공고 조건. matchIds 를 주면 찾는 말(query)은 그 id 로 거른다(lib/grants-search.ts searchNoticeIds — 띄어쓰기 무시 · AND · 본문 요약 · 가점 · 첨부까지).
 * 주지 않으면 예전처럼 제목 · 부처 · 기관 부분 일치
 */
export function noticeWhere(
  f: NoticeFilter,
  now = new Date(),
  matchIds?: string[] | null
): Prisma.GrantNoticeWhereInput {
  const verdictField = f.profile === "corp" ? "verdictCorp" : "verdictSole"
  const deadline: Prisma.GrantNoticeWhereInput =
    f.deadline === "all"
      ? {}
      : f.deadline === "open"
        ? { OR: [{ deadlineAt: { gte: now } }, { deadlineAt: null }] }
        : {
            deadlineAt: {
              gte: now,
              lt: new Date(
                now.getTime() + (f.deadline === "week" ? 7 : 30) * DAY
              ),
            },
          }
  return {
    AND: [
      { [verdictField]: { in: f.verdicts } },
      deadline,
      f.region
        ? { regionClass: { in: [...REGION_GROUPS[f.region].classes] } }
        : {},
      f.query && matchIds
        ? { id: { in: matchIds } }
        : f.query
        ? {
            OR: [
              { title: { contains: f.query, mode: "insensitive" } },
              { ministry: { contains: f.query, mode: "insensitive" } },
              { agency: { contains: f.query, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  }
}

/** 마감 가까운 것 먼저, 마감 없는 것은 뒤로 */
export const NOTICE_ORDER: Prisma.GrantNoticeOrderByWithRelationInput[] = [
  { deadlineAt: { sort: "asc", nulls: "last" } },
  { title: "asc" },
]

export function readStage(v: unknown): GrantStage | null {
  return typeof v === "string" && (GRANT_STAGES as string[]).includes(v)
    ? (v as GrantStage)
    : null
}
