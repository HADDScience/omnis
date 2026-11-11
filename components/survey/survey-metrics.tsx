import { INTENSITY_LABEL, tokensLabel, type Metrics } from "@/lib/ai-survey/metrics"
import { LIMIT_HITS, PAYERS, TASK_KINDS, TASK_SIZES, WISH_TAGS, type TaskKind, type Turn } from "@/lib/ai-survey/rules"

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`

/** 「근거: 2 · 5번 답」 — 지표가 어느 응답에서 나왔는지 */
function Source({ ids, turns }: { ids: string[] | undefined; turns: Turn[] }) {
  const nums = (ids ?? []).map((id) => turns.findIndex((t) => t.id === id) + 1).filter((n) => n > 0).sort((a, b) => a - b)
  if (nums.length === 0) return null
  return <span className="text-[12px] text-muted-foreground"> · 근거 {nums.join(" · ")}번 답</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2 last:border-b-0 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-[13px] text-muted-foreground sm:w-28">{label}</dt>
      <dd className="min-w-0 text-[14px] break-keep [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** 설문 한 건의 수치 지표 — 본인 확인 화면과 관리자 화면이 같이 쓴다. 값마다 근거 응답 번호를 붙인다 */
export function SurveyMetrics({ metrics: m, turns }: { metrics: Metrics; turns: Turn[] }) {
  const tasks = (Object.entries(m.taskShare) as [TaskKind, number][]).sort((a, b) => b[1] - a[1])
  const perWeek = [
    m.daysPerWeek !== null ? `주 ${m.daysPerWeek}일` : null,
    m.hoursPerWeek !== null ? `약 ${m.hoursPerWeek}시간${m.derived === "hours" ? "(어림)" : ""}` : null,
    m.sessionsPerWeek !== null ? `약 ${m.sessionsPerWeek.toLocaleString("ko-KR")}회${m.derived === "sessions" ? "(어림)" : ""}` : null,
  ].filter(Boolean)
  const wishes = [...m.wishTags.filter((t) => t !== "other").map((t) => WISH_TAGS[t]), ...m.wishNotes]
  return (
    <dl data-survey-metrics className="flex flex-col">
      <Row label="강도">
        <span className="font-medium">{INTENSITY_LABEL[m.intensity]}</span>
        <Source ids={m.evidence.intensity} turns={turns} />
      </Row>
      {perWeek.length > 0 && (
        <Row label="주당 사용">
          {perWeek.join(" · ")}
          <Source ids={m.evidence.perWeek} turns={turns} />
        </Row>
      )}
      {tasks.length > 0 && (
        <Row label="작업 비중">
          {tasks.map(([k, p]) => `${TASK_KINDS[k]} ${p}%`).join(" · ")}
          {m.taskSize && ` (보통 크기: ${TASK_SIZES[m.taskSize as keyof typeof TASK_SIZES] ?? m.taskSize})`}
          <Source ids={m.evidence.taskShare} turns={turns} />
        </Row>
      )}
      <Row label="월 토큰 추정">
        {m.monthlyTokens === null ? "산정하지 못함(사용량을 모름)" : (
          <>
            <span className="font-medium tabular-nums">약 {tokensLabel(m.monthlyTokens)}</span>
            {m.apiKrw && <span className="tabular-nums"> — 옴니스 API 로는 월 {won(m.apiKrw.cache89)}~{won(m.apiKrw.cache66)}</span>}
          </>
        )}
        <Source ids={m.evidence.monthlyTokens} turns={turns} />
      </Row>
      <Row label="유료 구독">
        {m.payer === null ? "모름" : m.payer === "none" ? "없음" : `${PAYERS[m.payer as keyof typeof PAYERS] ?? m.payer}${m.monthlyFeeKrw ? ` · 월 ${won(m.monthlyFeeKrw)}` : " · 금액 모름"}`}
        {m.tools.length > 0 && ` (${m.tools.join(", ")})`}
        <Source ids={m.evidence.subscription} turns={turns} />
      </Row>
      {m.limitHit && (
        <Row label="한도 경험">
          {LIMIT_HITS[m.limitHit as keyof typeof LIMIT_HITS] ?? m.limitHit}
          <Source ids={m.evidence.limitHit} turns={turns} />
        </Row>
      )}
      {wishes.length > 0 && (
        <Row label="바라는 것">
          {wishes.join(", ")}
          <Source ids={m.evidence.wishes} turns={turns} />
        </Row>
      )}
      {m.pains.length > 0 && (
        <Row label="아쉬운 점">
          {m.pains.join(", ")}
          <Source ids={m.evidence.pains} turns={turns} />
        </Row>
      )}
    </dl>
  )
}
