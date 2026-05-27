"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface EndpointUsage {
  endpoint: string
  totalTokens: number
  callCount: number
}

export interface GeminiUsageData {
  totalTokens: number
  promptTokens: number
  candidateTokens: number
  callCount: number
  byEndpoint: EndpointUsage[]
}

const ENDPOINT_LABELS: Record<string, string> = {
  structureTask: "업무 구조화",
  classifyMention: "멘션 분류",
  rebuildTask: "업무 재구성",
  weeklyReport: "주간보고",
  omnisAsk: "옴니스 질문",
  "embedTexts.RETRIEVAL_DOCUMENT": "문서 임베딩",
  "embedTexts.RETRIEVAL_QUERY": "질문 임베딩",
}

export function DashboardGeminiUsage({ data }: { data: GeminiUsageData }) {
  const empty = data.callCount === 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          AI 사용량 (이번 주)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-xs text-muted-foreground">
            이번 주 AI 사용 내역이 아직 없습니다.
          </p>
        ) : (
          <div className="flex items-center gap-6">
            <div>
              <div className="text-2xl font-bold">
                {data.totalTokens.toLocaleString()}
              </div>
              <div className="text-[10px] text-muted-foreground">총 토큰</div>
            </div>
            <div>
              <div className="text-lg font-semibold">{data.callCount}</div>
              <div className="text-[10px] text-muted-foreground">API 호출</div>
            </div>
            {data.byEndpoint.length > 0 && (
              <div className="flex flex-1 items-center gap-1">
                {data.byEndpoint.map((e) => {
                  const ratio =
                    data.totalTokens > 0
                      ? (e.totalTokens / data.totalTokens) * 100
                      : 0
                  return (
                    <div
                      key={e.endpoint}
                      className="flex flex-col items-center gap-0.5"
                      style={{ flex: ratio }}
                    >
                      <div
                        className="h-2 w-full rounded-full bg-primary/60"
                        title={`${ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}: ${e.totalTokens.toLocaleString()} 토큰`}
                      />
                      <span className="max-w-full truncate text-[8px] text-muted-foreground">
                        {ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
