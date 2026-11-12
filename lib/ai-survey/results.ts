// AI 활용 설문 — 관리자 결과 화면 · API 가 읽는 것. 합계만 낸다(이름 · 사람별 원문 · 사람별 지표 없음, 작업지시자 2026-11-12).
// 원문(turns)은 대기 시간 · 질문 출처를 세는 데만 쓰고 밖으로 내보내지 않는다. 본인 응답은 본인만 GET /api/ai-survey 로 본다.
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { companySummary, latencyTable, type CompanySummary, type LatencyRow } from "./metrics"
import type { Turn } from "./rules"

export interface SurveyResults {
  summary: CompanySummary
  latency: LatencyRow[]
  /** 설문 질문을 만드는 데 쓴 모델 비용(AiUsage feature "survey") */
  cost: { calls: number; krw: number; inputTokens: number; cachedInputTokens: number; outputTokens: number }
  /** 질문을 누가 만들었나 — 모델 · 준비된 질문 */
  sources: { model: number; fallback: number }
}

/** 결과는 관리자만 — 화면과 API 가 같은 규칙을 쓴다 */
export const canSeeSurveyResults = (role: string | null | undefined) => role === "ADMIN"

export async function loadSurveyResults(): Promise<SurveyResults> {
  const [members, rows, usage] = await Promise.all([
    prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID }, ...ACTIVE_MEMBER_WHERE }, select: { id: true } }),
    prisma.aiSurvey.findMany({ select: { userId: true, status: true, createdAt: true, facts: true, turns: true } }),
    prisma.aiUsage.aggregate({ where: { feature: "survey" }, _count: true, _sum: { costKrw: true, inputTokens: true, cachedInputTokens: true, outputTokens: true } }),
  ])
  const allTurns = rows.map((r) => r.turns as unknown as Turn[])
  const flat = allTurns.flat()
  return {
    summary: companySummary(members.map((m) => m.id), rows),
    // 대기 시간 · 질문 출처는 응답 내용이 아니라 설문 도구의 성능이다 — 응답 수와 상관없이 보인다
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
