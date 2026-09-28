import { Redis } from "@upstash/redis"
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
 *
 * ## 왜 바로 Postgres 에 쓰지 않는가
 *
 * Neon 은 마지막 질의 5분 뒤에 자고, **깨어 있던 시간이 곧 요금**이다. 방문 한 건마다
 * 쓰면 하루에 흩어진 방문 수십 건이 컴퓨트를 하루 한 시간씩 깨워 둔다(2026-09-28 실측:
 * 주 6.5시간, 그중 6.3시간은 방문 말고 아무것도 없던 시간). 그래서 받는 즉시는 Redis 에
 * 쌓고, **하루 한 번** 크론이 한꺼번에 옮긴다 — 깨우는 시간이 하루 5분으로 준다.
 *
 * 크론을 더 자주 돌리면 오히려 손해다. 크론 한 번이 최소 5분을 깨우므로 한 시간마다면
 * 하루 24 × 5분 = 2시간이고, 그것은 묶지 않은 지금보다 나쁘다.
 *
 * Redis 가 없거나 떨어져 있으면 **예전처럼 바로 쓴다.** 통계 한 건을 잃는 것보다
 * 컴퓨트를 한 번 깨우는 편이 낫다.
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

/** 들어온 방문이 쌓이는 곳. 크론이 통째로 가져간다. */
const BUFFER_KEY = "website:visits"
/** 옮기는 중인 것. 넣다 실패하면 여기 남아 다음 크론이 다시 집는다. */
const STAGING_KEY = "website:visits:flushing"

/**
 * Upstash 자격.
 *
 * `Redis.fromEnv()` 를 쓰지 않는다. 그쪽은 `UPSTASH_REDIS_REST_URL`·`..._TOKEN` 만 보는데
 * **Vercel 마켓플레이스 통합은 그 이름으로 넣어 주지 않는다.** 통합이 넣는 이름은
 * `KV_REST_API_URL`·`KV_REST_API_TOKEN` 이고, 연결할 때 접두어를 주면 그 앞에 붙는다.
 * 접두어를 무엇으로 줘도 `fromEnv()` 의 기본 이름은 안 나온다(2026-09-28 확인).
 *
 * 그래서 세 가지를 순서대로 본다. 접두어는 연결을 다시 할 때마다 달라질 수 있다 —
 * 실제로 2026-09-28 에 재연결 한 번으로 `UPSTASH_REDIS_REST_` 접두어가 떨어져 나갔다.
 * 이름 하나에 매달리면 그때마다 버퍼가 조용히 죽는다.
 *
 * 값을 복사해 기본 이름으로 다시 넣는 방법도 있지만 그러지 않는다 — 통합이 토큰을 돌리면
 * 복사본만 낡은 채로 남아, 어느 날 조용히 버퍼가 죽고 Postgres 로 되돌아간다.
 */
function credentials(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL ??
    process.env.UPSTASH_REDIS_REST_URL
  const token =
    process.env.KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN ??
    process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return { url, token }
}

/** Upstash 가 붙어 있을 때만 Redis 를 쓴다. 없으면 null 이고 호출부가 Postgres 로 간다. */
function buffer(): Redis | null {
  const c = credentials()
  return c ? new Redis(c) : null
}

/** 버퍼에 넣는 모양. `at` 을 여기서 박는다 — 크론이 옮기는 시각이 아니라 방문한 시각이어야 한다. */
interface BufferedVisit extends VisitIntake {
  at: string
}

export async function recordVisit(input: VisitIntake): Promise<void> {
  const redis = buffer()
  if (redis) {
    try {
      const row: BufferedVisit = { ...input, at: new Date().toISOString() }
      await redis.rpush(BUFFER_KEY, JSON.stringify(row))
      return
    } catch (e) {
      // 버퍼가 죽었다고 방문을 버리지 않는다. Neon 을 깨우더라도 적는 편이 낫다.
      console.warn("[visits] 버퍼 실패 — Postgres 로 바로 적는다", e)
    }
  }

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

export interface BufferStatus {
  /** Upstash 자격이 들어와 있는가. 없으면 버퍼를 안 쓰는 것이 정상이다 */
  configured: boolean
  /** 버퍼가 실제로 닿는가. configured 인데 false 면 **고장**이다 */
  ok: boolean
  /** 아직 Postgres 로 못 간 방문 수 */
  pending: number
}

/**
 * 버퍼의 상태. 통계 화면이 「집계 전 N건」 과 **고장 경고**를 띄우는 데 쓴다.
 *
 * `ok: false` 를 굳이 내보내는 이유: 버퍼가 죽으면 `recordVisit` 이 조용히 Postgres 로
 * 되돌아간다. 방문을 잃지 않으니 화면에는 아무 일도 없어 보이지만, 실제로는 Neon 을
 * 방문마다 깨우는 옛 상태로 돌아간 것이고 **아무도 모른다.**
 * 2026-09-28 에 실제로 그랬다 — Upstash 콘솔에서 토큰을 재발급했는데 Vercel env 는
 * 옛 토큰이라 `WRONGPASS` 가 났고, 로그를 들여다보기 전까지 아무 표시가 없었다.
 */
export async function bufferStatus(): Promise<BufferStatus> {
  const redis = buffer()
  if (!redis) return { configured: false, ok: true, pending: 0 }
  try {
    const [a, b] = await Promise.all([redis.llen(BUFFER_KEY), redis.llen(STAGING_KEY)])
    return { configured: true, ok: true, pending: a + b }
  } catch (e) {
    console.error("[visits] 버퍼에 닿지 못한다 — 방문이 Postgres 로 직행하고 있다", e)
    return { configured: true, ok: false, pending: 0 }
  }
}

/**
 * 버퍼에 쌓인 방문을 Postgres 로 옮긴다. 크론이 하루 한 번 부른다.
 *
 * 옮길 것을 **먼저 STAGING 으로 통째로 rename** 한 뒤 읽는다. 옮기는 사이에 들어온 방문은
 * 새 BUFFER 에 쌓여 다음 차례가 된다 — 읽고 나서 지우는 방식이면 그 사이에 들어온 것이
 * 함께 지워진다. `createMany` 가 실패하면 STAGING 이 그대로 남아 다음 크론이 다시 집는다.
 */
export async function flushVisits(): Promise<{ moved: number }> {
  const redis = buffer()
  if (!redis) return { moved: 0 }

  // 지난번에 옮겨 놓고 넣지 못한 것이 있으면 그것부터 끝낸다
  let staged = await redis.lrange<string>(STAGING_KEY, 0, -1)
  if (staged.length === 0) {
    // 버퍼가 비어 있으면 rename 이 실패한다 — 옮길 것이 없다는 뜻이라 정상이다
    await redis.rename(BUFFER_KEY, STAGING_KEY).catch(() => {})
    staged = await redis.lrange<string>(STAGING_KEY, 0, -1)
  }
  if (staged.length === 0) return { moved: 0 }

  const rows = staged.flatMap((raw) => {
    // Upstash 가 JSON 을 알아서 풀어 주는 경우가 있어 문자열·객체 둘 다 받는다
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as BufferedVisit
    const parsed = visitIntakeSchema.safeParse(v)
    // 모양이 깨진 한 건 때문에 나머지를 못 넣으면 안 된다
    if (!parsed.success) return []
    return [{
      at: new Date(v.at),
      path: parsed.data.path,
      lang: parsed.data.lang,
      visitorHash: parsed.data.visitorHash,
      referrerHost: parsed.data.referrerHost ?? null,
      device: parsed.data.device,
    }]
  })

  if (rows.length > 0) await prisma.websiteVisit.createMany({ data: rows })
  await redis.del(STAGING_KEY)
  return { moved: rows.length }
}

/* ------------------------------------------------------------ 읽기 */

export interface VisitStats {
  /** 몇 일치인가 */
  days: number
  /**
   * 아직 Postgres 로 넘어가지 않아 아래 숫자에 **들어 있지 않은** 방문 수.
   * 새벽 4시(KST) 크론이 옮긴다. 화면이 「오늘 0명」 을 장애로 오해하지 않게 하는 값이다.
   */
  pending?: number
  /**
   * 버퍼가 닿는가. `false` 면 방문이 Postgres 로 직행하고 있다 — 숫자는 맞지만
   * Neon 을 방문마다 깨우는 옛 상태다. 화면이 경고를 띄워야 한다.
   */
  bufferOk?: boolean
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
