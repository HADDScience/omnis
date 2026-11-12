import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ASSUMPTIONS, FLAG_LABEL, INTENSITY_LABEL, MIN_RESPONSES, tokensLabel, type CompanySummary, type Intensity, type LatencyRow } from "@/lib/ai-survey/metrics"
import type { SurveyResults } from "@/lib/ai-survey/results"
import { TASK_KINDS, WISH_TAGS } from "@/lib/ai-survey/rules"

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border p-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[18px] font-semibold tabular-nums break-keep">{value}</span>
      {sub && <span className="text-[12px] text-muted-foreground tabular-nums break-keep">{sub}</span>}
    </div>
  )
}

/** 가로 막대 한 줄 — 이름 · 값 · 막대. 색은 하나만 쓴다(크기 비교라 색으로 가를 것이 없다) */
function Bar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
      <span className="truncate">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(Math.min(pct, 100), 0)}%` }} />
      </div>
      <span className="tabular-nums text-muted-foreground">{value}</span>
    </div>
  )
}

const GRADES: Intensity[] = ["heavy", "medium", "light", "none", "unknown"]

/** 회사 전체 — 합계만. 이름 · 사람별 원문은 없다. 응답이 MIN_RESPONSES 명 미만이면 합계도 숨긴다 */
function CompanyTab({ s }: { s: CompanySummary }) {
  const counts = `구성원 ${s.headcount}명 · 제출 ${s.respondents}명 · 답하는 중 ${s.inProgress}명 · 시작 전 ${s.notStarted}명`
  const t = s.totals
  if (!t) {
    return (
      <Empty className="rounded-xl border border-dashed" data-survey-hidden>
        <EmptyHeader>
          <EmptyTitle>응답 {MIN_RESPONSES}명부터 보입니다</EmptyTitle>
          <EmptyDescription>{counts}. 응답이 적으면 합계만으로도 누가 어떻게 답했는지 짐작할 수 있어 숨깁니다.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const maxWish = Math.max(...t.wishRanking.map((w) => w.count), 1)
  const maxPain = Math.max(...t.painRanking.map((w) => w.count), 1)
  return (
    <div className="flex flex-col gap-4" data-survey-company>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">회사 전체 AI 사용량 추정</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-[12px] text-muted-foreground break-keep" data-survey-counts>{counts}</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Stat label="응답" value={`${s.respondents} / ${s.headcount}명`} sub={t.needsCheck ? `확인 필요 ${t.needsCheck}명은 추정에서 뺐습니다` : undefined} />
            <Stat label="지난주 평균 사용 일수" value={t.avgDays === null ? "–" : `${t.avgDays}일`} />
            <Stat
              label="회사 월 토큰 추정(전원)"
              value={t.tokens ? `약 ${tokensLabel(t.tokens.projected)}` : "산정하지 못함"}
              sub={t.tokens ? `95% 범위 ${tokensLabel(t.tokens.low)} ~ ${tokensLabel(t.tokens.high)} · 응답 ${t.counted}명 기준${t.unknownGrade ? ` · 사용량 모름 ${t.unknownGrade}명 제외` : ""}` : undefined}
            />
            <Stat label="옴니스 API 환산(월, 전원)" value={t.apiKrw ? `${won(t.apiKrw.low)} ~ ${won(t.apiKrw.high)}` : "–"} sub="범위 아래 끝 × 캐시 89% ~ 위 끝 × 캐시 66.6%" />
            <Stat label="유료로 쓰는 사람" value={`${t.paid}명`} sub={`그중 개인이 내는 사람 ${t.personalPay}명 · 구독료 합 월 ${won(t.subscriptionKrw)}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">강도 분포</h3>
            {GRADES.filter((g) => t.grades[g] > 0).map((g) => <Bar key={g} label={INTENSITY_LABEL[g]} value={`${t.grades[g]}명`} pct={(t.grades[g] / s.respondents) * 100} />)}
          </div>
          {t.needsCheck > 0 && (
            <div className="flex flex-col gap-1" data-survey-needs-check>
              <h3 className="text-[13px] font-medium">확인 필요 — 앞뒤가 안 맞는 응답 {t.needsCheck}명</h3>
              <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] break-keep text-muted-foreground">
                {t.flagCounts.map((f) => <li key={f.code}>{FLAG_LABEL[f.code]} — {f.count}명</li>)}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">작업 · 바라는 것 · 아쉬운 점</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">작업 종류 분포(응답자 평균)</h3>
            {t.taskShare.length === 0 ? <p className="text-[13px] text-muted-foreground">작업을 답한 사람이 없습니다.</p> : t.taskShare.map((x) => <Bar key={x.kind} label={TASK_KINDS[x.kind]} value={`${x.pct}%`} pct={x.pct} />)}
          </div>
          {t.recentTasks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-[13px] font-medium">가장 최근에 맡긴 일</h3>
              {t.recentTasks.map((x) => <Bar key={x.label} label={x.label} value={`${x.count}명`} pct={(x.count / s.respondents) * 100} />)}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">옴니스에 바라는 것</h3>
            {t.wishRanking.length === 0 ? <p className="text-[13px] text-muted-foreground">아직 없습니다.</p> : t.wishRanking.map((w) => <Bar key={w.tag} label={WISH_TAGS[w.tag]} value={`${w.count}명`} pct={(w.count / maxWish) * 100} />)}
            {(t.wishNotes.length > 0 || t.wishOthers > 0) && (
              <p className="text-[13px] break-keep text-muted-foreground">
                기타로 적은 것: {[...t.wishNotes.map((n) => `${n.label} ${n.count}명`), ...(t.wishOthers ? [`한 명만 적은 것 ${t.wishOthers}가지`] : [])].join(" · ")}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5" data-survey-pains>
            <h3 className="text-[13px] font-medium">범용 AI 의 아쉬운 점</h3>
            {t.painRanking.length === 0 && t.painOthers === 0 ? <p className="text-[13px] text-muted-foreground">아직 없습니다.</p> : t.painRanking.map((w) => <Bar key={w.label} label={w.label} value={`${w.count}명`} pct={(w.count / maxPain) * 100} />)}
            {t.painOthers > 0 && <p className="text-[13px] text-muted-foreground">한 명만 고른 것 {t.painOthers}가지 — 글은 보이지 않습니다.</p>}
          </div>
          <details className="text-[12px] text-muted-foreground">
            <summary className="touch-target flex cursor-pointer list-none items-center underline underline-offset-4">이 숫자의 가정 보기</summary>
            <ul className="flex list-disc flex-col gap-1 pl-5 break-keep">
              {ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
              <li>토큰 대표값은 다른 모델 기준의 외부 통계라 규모를 가늠하는 값입니다.</li>
              <li>이름과 사람별 응답은 이 화면에 없습니다. 본인 응답은 본인만 「설문 확인하기」 에서 봅니다.</li>
            </ul>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}

const sec = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)}초`)

/** 응답 대기 · 질문 생성 비용 — 설문이 얼마나 빨랐고 얼마가 들었나 */
function LatencyTab({ latency, cost, sources }: { latency: LatencyRow[]; cost: SurveyResults["cost"]; sources: SurveyResults["sources"] }) {
  const cached = cost.inputTokens > 0 ? Math.round((cost.cachedInputTokens / cost.inputTokens) * 100) : null
  return (
    <Card data-survey-latency>
      <CardHeader>
        <CardTitle className="text-base">응답 대기 · 비용</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="text-muted-foreground">
            <tr><th className="py-1 text-left font-normal">무엇</th><th className="text-right font-normal">표본</th><th className="text-right font-normal">중앙값</th><th className="text-right font-normal">90%</th></tr>
          </thead>
          <tbody>
            {latency.map((r) => (
              <tr key={r.label} className="border-t">
                <td className="py-1 pr-2 break-keep">{r.label}</td>
                <td className="text-right">{r.count}</td>
                <td className="text-right">{sec(r.p50)}</td>
                <td className="text-right">{sec(r.p90)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px] break-keep">
          질문 {sources.model + sources.fallback}개 가운데 모델이 만든 것 {sources.model}개 · 준비된 질문 {sources.fallback}개.
          모델 호출 {cost.calls.toLocaleString("ko-KR")}번 · {won(cost.krw)}
          {cost.calls > 0 && ` (한 번에 ${(cost.krw / cost.calls).toFixed(1)}원)`}
          {cached !== null && ` · 입력 캐시 ${cached}%`}.
        </p>
        <p className="text-[12px] text-muted-foreground break-keep">
          모델이 만든 질문만 잰 값입니다. 「화면」 은 응답자가 누른 때부터, 「서버」 는 요청을 받은 때부터입니다. 비용은 AI 사용량(마이 → 사용량)에 함께 잡힙니다.
        </p>
      </CardContent>
    </Card>
  )
}

/** 관리자 결과 화면 — 회사 전체 합계 · 응답 대기. 사람별 화면은 없다 */
export function SurveyResultsView({ results }: { results: SurveyResults }) {
  return (
    <Tabs defaultValue="company" data-survey-results>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="company">회사 전체</TabsTrigger>
        <TabsTrigger value="latency">대기 · 비용</TabsTrigger>
      </TabsList>
      <TabsContent value="company" className="mt-3"><CompanyTab s={results.summary} /></TabsContent>
      <TabsContent value="latency" className="mt-3"><LatencyTab latency={results.latency} cost={results.cost} sources={results.sources} /></TabsContent>
    </Tabs>
  )
}
