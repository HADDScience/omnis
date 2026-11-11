import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ASSUMPTIONS, INTENSITY_LABEL, tokensLabel, type CompanyEstimate, type Intensity, type LatencyRow } from "@/lib/ai-survey/metrics"
import type { PersonResult, SurveyResults } from "@/lib/ai-survey/results"
import { TASK_KINDS, WISH_TAGS, answerText } from "@/lib/ai-survey/rules"
import { SurveyMetrics } from "./survey-metrics"

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`
const STATUS_LABEL: Record<string, string> = { IN_PROGRESS: "답하는 중", CONFIRM: "확인 대기", SUBMITTED: "제출" }

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

/** 회사 전체 추정 — 응답자 합산과, 그 평균을 전원에게 늘린 값 */
function CompanyTab({ e }: { e: CompanyEstimate }) {
  if (e.respondents === 0) {
    return (
      <Empty className="rounded-xl border border-dashed" data-survey-empty>
        <EmptyHeader>
          <EmptyTitle>아직 제출한 사람이 없습니다</EmptyTitle>
          <EmptyDescription>구성원 {e.headcount}명 가운데 답하는 중 {e.inProgress.length}명 · 시작 전 {e.notStarted.length}명.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const maxWish = Math.max(...e.wishRanking.map((w) => w.count), 1)
  return (
    <div className="flex flex-col gap-4" data-survey-company>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">회사 전체 AI 사용량 추정</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Stat label="응답" value={`${e.respondents} / ${e.headcount}명`} sub={e.unknownGrade ? `사용량을 몰라 합산에서 빠진 사람 ${e.unknownGrade}명` : undefined} />
            <Stat label="월 토큰(응답자 합)" value={`약 ${tokensLabel(e.monthlyTokens)}`} sub={e.projected ? `전원(${e.headcount}명)으로 늘리면 약 ${tokensLabel(e.projected.monthlyTokens)}` : undefined} />
            <Stat
              label="옴니스 API 환산(월, 응답자 합)"
              value={`${won(e.apiKrw.cache89)} ~ ${won(e.apiKrw.cache66)}`}
              sub={e.projected ? `전원이면 ${won(e.projected.apiKrw.cache89)} ~ ${won(e.projected.apiKrw.cache66)}` : undefined}
            />
            <Stat label="지금 내는 구독료(월)" value={won(e.subscriptionKrw.total)} sub={`회사 ${won(e.subscriptionKrw.company)} · 개인 ${won(e.subscriptionKrw.personal)} · 둘 다 ${won(e.subscriptionKrw.both)}`} />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">강도 등급</h3>
            {GRADES.filter((g) => e.grades[g] > 0).map((g) => <Bar key={g} label={INTENSITY_LABEL[g]} value={`${e.grades[g]}명`} pct={(e.grades[g] / e.respondents) * 100} />)}
          </div>
          <p className="text-[12px] text-muted-foreground break-keep">
            미응답 — 답하는 중: {e.inProgress.length ? e.inProgress.join(", ") : "없음"} · 시작 전: {e.notStarted.length ? e.notStarted.join(", ") : "없음"}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">작업 종류 · 바라는 기능</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">작업 종류 분포(응답자 평균)</h3>
            {e.taskShare.length === 0 ? <p className="text-[13px] text-muted-foreground">작업을 답한 사람이 없습니다.</p> : e.taskShare.map((t) => <Bar key={t.kind} label={TASK_KINDS[t.kind]} value={`${t.pct}%`} pct={t.pct} />)}
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">바라는 기능 순위</h3>
            {e.wishRanking.length === 0 ? <p className="text-[13px] text-muted-foreground">아직 없습니다.</p> : e.wishRanking.map((w) => <Bar key={w.tag} label={WISH_TAGS[w.tag]} value={`${w.count}명`} pct={(w.count / maxWish) * 100} />)}
            {e.wishNotes.length > 0 && <p className="text-[13px] break-keep text-muted-foreground">기타로 적은 것: {e.wishNotes.join(" · ")}</p>}
          </div>
          <details className="text-[12px] text-muted-foreground">
            <summary className="touch-target flex cursor-pointer list-none items-center underline underline-offset-4">이 숫자의 가정 보기</summary>
            <ul className="flex list-disc flex-col gap-1 pl-5 break-keep">
              {ASSUMPTIONS.map((a) => <li key={a}>{a}</li>)}
              <li>토큰 대표값은 다른 모델 기준의 외부 통계라 규모를 가늠하는 값입니다.</li>
            </ul>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}

function PersonRow({ p }: { p: PersonResult }) {
  const m = p.metrics
  const answered = p.turns.filter((t) => t.answer)
  return (
    <details className="border-b py-2 last:border-b-0" data-survey-person={p.userId}>
      <summary className="touch-target flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[14px]">
        <span className="font-medium">{p.name}</span>
        <span className="tabular-nums text-muted-foreground">
          {p.status ? STATUS_LABEL[p.status] ?? p.status : "시작 전"}
          {p.redoing && " · 다시 하는 중"}
          {p.records > 1 && ` · 기록 ${p.records}건`}
          {m && ` · ${INTENSITY_LABEL[m.intensity]}`}
          {m?.monthlyTokens != null && ` · 월 약 ${tokensLabel(m.monthlyTokens)}`}
        </span>
      </summary>
      {p.status === null ? (
        <p className="py-2 text-[13px] text-muted-foreground">아직 시작하지 않았습니다.</p>
      ) : (
        <div className="flex flex-col gap-3 py-2">
          {(p.redoing || p.records > 1) && (
            <p className="text-[12px] text-muted-foreground break-keep">
              가장 최근에 제출한 응답입니다 — 집계에는 이 1건만 씁니다.{p.redoing && " 지금 다시 답하는 중이고, 제출하면 그 응답으로 바뀝니다."}
            </p>
          )}
          {p.summary && <p className="rounded-lg bg-muted/60 p-3 text-[13px] leading-relaxed break-keep">{p.summary}</p>}
          {m && <SurveyMetrics metrics={m} turns={p.turns} />}
          <div>
            <h3 className="mb-1 text-[13px] font-medium">원문 — 질문 · 제시한 보기 · 응답</h3>
            <ol className="flex flex-col gap-2">
              {answered.map((t, i) => (
                <li key={t.id} className="text-[13px] break-keep">
                  <span>{i + 1}. {t.ask.question}</span>
                  {t.ask.fields.map((f) => (
                    <span key={f.id} className="block pl-4">
                      <span className="text-muted-foreground">
                        {f.label ? `${f.label} · ` : ""}
                        {f.options ? `보기: ${f.options.map((o) => o.label).join(" / ")}` : f.kind === "text" ? "한 줄 글" : `${f.min}~${f.max}${f.unit ?? ""}`}
                      </span>
                      <br />
                      <span className="font-medium">→ {answerText(f, t.answer?.[f.id])}</span>
                    </span>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </details>
  )
}

/** 사람별 지표와 원문 — 눌러서 편다 */
function PeopleTab({ people }: { people: PersonResult[] }) {
  return (
    <Card data-survey-people>
      <CardHeader>
        <CardTitle className="text-base">사람별 — 눌러서 지표 · 원문 보기</CardTitle>
      </CardHeader>
      <CardContent>
        {people.length === 0 ? <p className="text-[13px] text-muted-foreground">구성원이 없습니다.</p> : people.map((p) => <PersonRow key={p.userId} p={p} />)}
      </CardContent>
    </Card>
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

/** 관리자 결과 화면 — 회사 전체 추정 · 사람별 원문 · 응답 대기 */
export function SurveyResultsView({ results }: { results: SurveyResults }) {
  return (
    <Tabs defaultValue="company" data-survey-results>
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="company">회사 전체</TabsTrigger>
        <TabsTrigger value="people">사람별</TabsTrigger>
        <TabsTrigger value="latency">대기 · 비용</TabsTrigger>
      </TabsList>
      <TabsContent value="company" className="mt-3"><CompanyTab e={results.estimate} /></TabsContent>
      <TabsContent value="people" className="mt-3"><PeopleTab people={results.people} /></TabsContent>
      <TabsContent value="latency" className="mt-3"><LatencyTab latency={results.latency} cost={results.cost} sources={results.sources} /></TabsContent>
    </Tabs>
  )
}
