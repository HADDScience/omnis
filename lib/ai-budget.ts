// AI 비용 상한 — DB 쪽. 규칙은 lib/ai-budget-rules.ts(순수).
// 설정: AppSetting ai_budget(관리자 화면) → 없으면 env 기본값. 원천: AiUsage.costKrw.
import { prisma } from "@/lib/db"
import { readSetting, writeSetting } from "@/lib/app-settings"
import { kstDayStart } from "@/lib/agent/quota"
import {
  budgetDefaults, budgetRefusal, kstDayKey, kstMonthStart, mergeBudget, userDailyLimit,
  type BudgetBlock, type BudgetSettings,
} from "@/lib/ai-budget-rules"

export const BUDGET_KEY = "ai_budget"

export async function loadBudget(): Promise<BudgetSettings> {
  return mergeBudget(budgetDefaults(), await readSetting(BUDGET_KEY))
}

export async function saveBudget(b: BudgetSettings, by: string): Promise<void> {
  await writeSetting(BUDGET_KEY, b, by)
}

/** 이번 달 회사 누적 · 이 사람의 오늘 누적(원) */
export async function spentNow(userId: string, now = new Date()): Promise<{ userTodayKrw: number; monthKrw: number }> {
  const [month, today] = await Promise.all([
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: kstMonthStart(now) } }, _sum: { costKrw: true } }),
    prisma.aiUsage.aggregate({ where: { userId, createdAt: { gte: kstDayStart(now) } }, _sum: { costKrw: true } }),
  ])
  return { monthKrw: Number(month._sum.costKrw ?? 0), userTodayKrw: Number(today._sum.costKrw ?? 0) }
}

/** 새 옴니스 실행을 막을 이유(429) — 없으면 null */
export async function budgetGate(userId: string): Promise<{ status: 429; error: string; budget: BudgetBlock } | null> {
  const [b, used, user] = await Promise.all([
    loadBudget(),
    spentNow(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])
  return budgetRefusal(used, b, { userId, isAdmin: user?.role === "ADMIN" })
}

export interface DayRow { day: string; count: number; krw: number }
export interface PersonUsage { userId: string | null; name: string; todayKrw: number; limitKrw: number | null; monthKrw: number; monthCount: number; days: DayRow[] }

export interface UsageReport {
  month: string
  monthKrw: number
  monthlyKrw: number
  userDailyKrw: number
  people: PersonUsage[]
}

/** 이번 달 사람별 · 일별 건수 · 비용. userId 를 주면 그 사람만(본인 화면) */
export async function usageReport(opts: { userId?: string } = {}, now = new Date()): Promise<UsageReport> {
  const since = kstMonthStart(now)
  const todayKey = kstDayKey(now)
  const [b, rows, monthTotal] = await Promise.all([
    loadBudget(),
    prisma.$queryRaw<{ userId: string | null; day: string; count: bigint; krw: number }[]>`
      SELECT "userId", to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
             count(*) AS count, coalesce(sum("costKrw"), 0)::float8 AS krw
      FROM "AiUsage"
      WHERE "createdAt" >= ${since} AND (${opts.userId ?? null}::text IS NULL OR "userId" = ${opts.userId ?? null}::text)
      GROUP BY 1, 2 ORDER BY 2 DESC`,
    prisma.aiUsage.aggregate({ where: { createdAt: { gte: since } }, _sum: { costKrw: true } }),
  ])
  const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))]
  const names = new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
  const people = new Map<string, PersonUsage>()
  for (const r of rows) {
    const key = r.userId ?? ""
    let p = people.get(key)
    if (!p) {
      p = {
        userId: r.userId,
        name: r.userId ? names.get(r.userId) ?? "(없는 계정)" : "(사람 없음 · 자동 작업)",
        todayKrw: 0, limitKrw: r.userId ? userDailyLimit(b, r.userId) : null, monthKrw: 0, monthCount: 0, days: [],
      }
      people.set(key, p)
    }
    const count = Number(r.count)
    p.days.push({ day: r.day, count, krw: r.krw })
    p.monthKrw += r.krw
    p.monthCount += count
    if (r.day === todayKey) p.todayKrw += r.krw
  }
  return {
    month: kstDayKey(now).slice(0, 7),
    monthKrw: Number(monthTotal._sum.costKrw ?? 0),
    monthlyKrw: b.monthlyKrw,
    userDailyKrw: b.userDailyKrw,
    people: [...people.values()].sort((a, b2) => b2.monthKrw - a.monthKrw),
  }
}
