import { z } from "zod"

import { prisma } from "@/lib/db"

/**
 * 홈페이지 방문 통계.
 *
 * 사이트가 방문 한 건씩 넣고(`POST /api/website/visits`) 관리 화면이 집계해서 읽는다
 * (`GET /api/website/stats`). 설계의 정본은
 * `mydocs/plans/2026-09-22-website-visit-stats.md`.
 *
 * **여기에는 IP 도 UA 도 쿠키도 없다.** 방문자 구분은 사이트가 만들어 보낸 하루짜리
 * 해시뿐이고, 날짜가 그 해시 키에 들어가 있어 어제와 오늘을 이어 붙일 수 없다.
 */

/* ------------------------------------------------------------ 적기 */

export const visitIntakeSchema = z.object({
  /// 질의문자·해시를 뗀 경로. 길이를 막는 것은 봇이 긴 문자열로 표를 불리지 못하게 하는 것이다
  path: z.string().min(1).max(512),
  lang: z.enum(["ko", "en"]),
  visitorHash: z.string().regex(/^[0-9a-f]{32}$/),
  referrerHost: z.string().max(128).nullable().optional(),
  device: z.enum(["mobile", "desktop"]),
})

export type VisitIntake = z.infer<typeof visitIntakeSchema>

export async function recordVisit(input: VisitIntake): Promise<void> {
  await prisma.websiteVisit.create({
    data: {
      path: input.path,
      lang: input.lang,
      visitorHash: input.visitorHash,
      referrerHost: input.referrerHost ?? null,
      device: input.device,
    },
  })
}

/* ------------------------------------------------------------ 읽기 */

export interface VisitStats {
  /** 몇 일치인가 */
  days: number
  /** 기간의 첫 날 · 끝 날 (KST, `YYYY-MM-DD`) */
  from: string
  to: string
  /** 기간 전체. visitors 는 날짜별 합이 아니라 기간 안의 서로 다른 해시 수다 */
  totals: { views: number; visitors: number }
  /** 오늘(KST) */
  today: { views: number; visitors: number }
  /** 날짜별. 방문이 없는 날도 0 으로 채워 자리를 지킨다 */
  daily: { date: string; views: number; visitors: number }[]
  topPaths: { path: string; views: number; visitors: number }[]
  /**
   * 글별. 한국어판과 영문판을 한 글로 합쳐 센다 — 관리 화면의 목록이 글 하나를 한 줄로
   * 보여 주므로, 언어별로 나누면 그 줄에 둘을 붙일 자리가 없다.
   * 방문이 한 번도 없는 글은 아예 나오지 않는다(화면에서 0 으로 읽는다).
   */
  posts: { id: string; views: number; visitors: number }[]
  referrers: { host: string; views: number }[]
  devices: { device: string; views: number }[]
}

/**
 * 하루 경계는 KST 다. UTC 로 자르면 한국 시간 오전 9시 전에 들어온 방문이 어제로 넘어간다.
 *
 * `at` 은 시간대 없는 timestamp(UTC 로 들어 있다). 그래서 UTC 를 한 번 붙인 뒤
 * 서울로 옮긴다 — 바로 `AT TIME ZONE 'Asia/Seoul'` 하면 값을 서울 시각으로 읽어 9시간 틀어진다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/** KST 로 `daysAgo` 일 전 자정의 UTC 시각. */
function kstMidnight(daysAgo: number): Date {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS)
  const midnight = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate() - daysAgo
  )
  return new Date(midnight - KST_OFFSET_MS)
}

/** UTC 시각을 KST 날짜 문자열로. */
function kstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

type Row = { date: string; views: number; visitors: number }

export async function visitStats(days: number): Promise<VisitStats> {
  const from = kstMidnight(days - 1)
  const todayStart = kstMidnight(0)

  const [daily, totals, today, topPaths, posts, referrers, devices] = await Promise.all([
    prisma.$queryRaw<Row[]>`
      SELECT to_char(("at" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM-DD') AS date,
             COUNT(*)::int AS views,
             COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM "WebsiteVisit" WHERE "at" >= ${from}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw<{ views: number; visitors: number }[]>`
      SELECT COUNT(*)::int AS views, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM "WebsiteVisit" WHERE "at" >= ${from}
    `,
    prisma.$queryRaw<{ views: number; visitors: number }[]>`
      SELECT COUNT(*)::int AS views, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM "WebsiteVisit" WHERE "at" >= ${todayStart}
    `,
    prisma.$queryRaw<{ path: string; views: number; visitors: number }[]>`
      SELECT "path", COUNT(*)::int AS views, COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM "WebsiteVisit" WHERE "at" >= ${from}
      GROUP BY 1 ORDER BY views DESC, "path" ASC LIMIT 10
    `,
    prisma.$queryRaw<{ id: string; views: number; visitors: number }[]>`
      SELECT split_part("path", '/', 4) AS id,
             COUNT(*)::int AS views,
             COUNT(DISTINCT "visitorHash")::int AS visitors
      FROM "WebsiteVisit"
      WHERE "at" >= ${from}
        -- 글 주소만. 목록(/ko/news)도 쪽나누기(/ko/news/page/3)도 조각 수가 달라 걸리지 않는다
        AND "path" ~ '^/(ko|en)/(news|library)/[^/]+$'
      GROUP BY 1 ORDER BY views DESC, id ASC
    `,
    prisma.$queryRaw<{ host: string; views: number }[]>`
      SELECT "referrerHost" AS host, COUNT(*)::int AS views
      FROM "WebsiteVisit" WHERE "at" >= ${from} AND "referrerHost" IS NOT NULL
      GROUP BY 1 ORDER BY views DESC, host ASC LIMIT 8
    `,
    prisma.$queryRaw<{ device: string; views: number }[]>`
      SELECT "device", COUNT(*)::int AS views
      FROM "WebsiteVisit" WHERE "at" >= ${from}
      GROUP BY 1 ORDER BY views DESC
    `,
  ])

  // 방문이 없는 날은 질의 결과에 아예 없다. 빈 날을 0 으로 채워야 그래프의 가로축이
  // 날짜에 비례한다 — 빠뜨리면 뜸했던 기간이 붙어 버려 추이를 거짓으로 보여 준다.
  const found = new Map(daily.map((d) => [d.date, d]))
  const filled: Row[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = kstDate(kstMidnight(i))
    filled.push(found.get(date) ?? { date, views: 0, visitors: 0 })
  }

  return {
    days,
    from: kstDate(from),
    to: kstDate(todayStart),
    totals: totals[0] ?? { views: 0, visitors: 0 },
    today: today[0] ?? { views: 0, visitors: 0 },
    daily: filled,
    topPaths,
    posts,
    referrers,
    devices,
  }
}
