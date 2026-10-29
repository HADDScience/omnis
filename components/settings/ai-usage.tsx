import { startOfWeek } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { prisma } from "@/lib/db"

const ENDPOINT_LABELS: Record<string, string> = {
  structureTask: "업무 구조화",
  classifyMention: "멘션 분류",
  rebuildTask: "업무 재구성",
  weeklyReport: "주간보고",
  omnisAsk: "옴니스 질문",
  "embedTexts.RETRIEVAL_DOCUMENT": "문서 임베딩",
  "embedTexts.RETRIEVAL_QUERY": "질문 임베딩",
}

/**
 * AI 사용량(이번 주, 월요일부터) — 마이 탭의 한 칸.
 *
 * 업무 탭 제목줄 오른쪽에 숫자 하나로 있다가 2026-10-29 여기로 옮겼다(작업지시자) — 업무를 보는 자리에 둘
 * 값이 아니다. 숫자 위에 마우스를 올려야 펼쳐지던 내역은 폰에서 열 길이 없어, 여기서는 처음부터 펼쳐 둔다.
 */
export async function AiUsage() {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const [total, byEndpoint] = await Promise.all([
    prisma.geminiUsage.aggregate({
      where: { createdAt: { gte: weekStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.geminiUsage.groupBy({
      by: ["endpoint"],
      where: { createdAt: { gte: weekStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
  ])
  const totalTokens = total._sum.totalTokens ?? 0
  const endpoints = byEndpoint
    .map((e) => ({ endpoint: e.endpoint, totalTokens: e._sum.totalTokens ?? 0 }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">AI 사용량 (이번 주)</CardTitle>
      </CardHeader>
      <CardContent>
        {total._count === 0 ? (
          <p className="text-sm text-muted-foreground">이번 주 AI 사용 내역이 아직 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-4">
              <div>
                <div className="text-xl font-bold tabular-nums">{totalTokens.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground">총 토큰</div>
              </div>
              <div>
                <div className="text-base font-semibold tabular-nums">{total._count}</div>
                <div className="text-[10px] text-muted-foreground">API 호출</div>
              </div>
            </div>

            {endpoints.length > 0 && (
              <ul className="flex flex-col gap-1">
                {endpoints.map((e) => {
                  const ratio = totalTokens > 0 ? (e.totalTokens / totalTokens) * 100 : 0
                  return (
                    <li key={e.endpoint} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate">{ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {e.totalTokens.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${ratio}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
