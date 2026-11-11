// AI 활용 설문 — 관리자 결과 화면이 읽는 것. 원문(turns)이 들어 있으므로 관리자 확인을 거친 뒤에만 부른다.
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { companyEstimate, latencyTable, type CompanyEstimate, type LatencyRow, type Metrics } from "./metrics"
import type { Turn } from "./rules"

export interface PersonResult {
  userId: string
  name: string
  /** 시작하지 않았으면 null */
  status: string | null
  turns: Turn[]
  summary: string | null
  metrics: Metrics | null
  submittedAt: Date | null
}

export interface SurveyResults {
  estimate: CompanyEstimate
  people: PersonResult[]
  latency: LatencyRow[]
  /** 설문 질문을 만드는 데 쓴 모델 비용(AiUsage feature "survey") */
  cost: { calls: number; krw: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }
  /** 질문을 누가 만들었나 — 모델 · 준비된 질문 */
  sources: { model: number; fallback: number }
}

export async function loadSurveyResults(): Promise<SurveyResults> {
  const [members, rows, usage] = await Promise.all([
    prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID }, ...ACTIVE_MEMBER_WHERE }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.aiSurvey.findMany(),
    prisma.aiUsage.aggregate({ where: { feature: "survey" }, _count: true, _sum: { costKrw: true, inputTokens: true, cachedInputTokens: true, outputTokens: true } }),
  ])
  const byUser = new Map(rows.map((r) => [r.userId, r]))
  const people: PersonResult[] = members.map((m) => {
    const r = byUser.get(m.id)
    return {
      userId: m.id, name: m.name,
      status: r?.status ?? null,
      turns: (r?.turns as unknown as Turn[] | undefined) ?? [],
      summary: r?.summary ?? null,
      metrics: (r?.metrics as unknown as Metrics | null | undefined) ?? null,
      submittedAt: r?.submittedAt ?? null,
    }
  })
  const allTurns = rows.map((r) => r.turns as unknown as Turn[])
  const flat = allTurns.flat()
  return {
    estimate: companyEstimate({ members, surveys: rows.map((r) => ({ userId: r.userId, status: r.status, metrics: r.metrics as unknown as Metrics | null })) }),
    people,
    latency: latencyTable(allTurns),
    cost: {
      calls: usage._count,
      krw: Number(usage._sum.costKrw ?? 0),
      inputTokens: usage._sum.inputTokens ?? 0,
      cachedInputTokens: usage._sum.cachedInputTokens ?? 0,
      outputTokens: usage._sum.outputTokens ?? 0,
    },
    sources: { model: flat.filter((t) => t.source === "model").length, fallback: flat.filter((t) => t.source === "fallback").length },
  }
}
