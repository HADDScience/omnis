"use client"

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon } from "@hugeicons/core-free-icons"

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

/** 1,234 → "1.2K" · 1,234,567 → "1.2M". 헤더 한 줄에 들어가야 하므로 줄여 쓴다. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/**
 * AI 사용량 — 헤더 우측 상단의 숫자 하나.
 *
 * 카드 한 장을 차지할 만큼 자주 보는 값이 아니다. 평소에는 숫자로만 있고,
 * 궁금할 때 마우스를 올리면 그때 내역을 펼친다.
 */
export function DashboardGeminiBadge({ data }: { data: GeminiUsageData }) {
  const empty = data.callCount === 0

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <button
            type="button"
            aria-label={`이번 주 AI 사용량 ${data.totalTokens.toLocaleString()} 토큰`}
            className="flex h-8 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none"
          />
        }
      >
        <HugeiconsIcon icon={AiMagicIcon} size={14} aria-hidden className="text-primary" />
        <span className="text-xs font-medium tabular-nums">
          {empty ? "—" : compact(data.totalTokens)}
        </span>
      </HoverCardTrigger>

      <HoverCardContent align="end" className="w-72">
        <div className="mb-2 text-xs font-medium">AI 사용량 (이번 주)</div>

        {empty ? (
          <p className="text-xs text-muted-foreground">이번 주 AI 사용 내역이 아직 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline gap-4">
              <div>
                <div className="text-xl font-bold tabular-nums">
                  {data.totalTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-muted-foreground">총 토큰</div>
              </div>
              <div>
                <div className="text-base font-semibold tabular-nums">{data.callCount}</div>
                <div className="text-[10px] text-muted-foreground">API 호출</div>
              </div>
            </div>

            {data.byEndpoint.length > 0 && (
              <ul className="flex flex-col gap-1">
                {data.byEndpoint.map((e) => {
                  const ratio =
                    data.totalTokens > 0 ? (e.totalTokens / data.totalTokens) * 100 : 0
                  return (
                    <li key={e.endpoint} className="flex flex-col gap-0.5">
                      <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="truncate">
                          {ENDPOINT_LABELS[e.endpoint] ?? e.endpoint}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {e.totalTokens.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${ratio}%` }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
