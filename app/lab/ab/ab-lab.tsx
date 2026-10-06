"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import { OmnisMarkdown } from "@/components/omnis/omnis-ask"
import { apiUrl } from "@/lib/base-path"
// 타입만 가져온다 — trial.ts 는 fs 를 쓰는 서버 모듈이다
import type { LabStatus, Pair, Scores, Side, SideView, TrialEvent } from "@/bench/lab-ab/trial"

const API = "/api/lab/ab"
const SIDES: Side[] = ["A", "B"]
const SCORE_ITEMS: { key: keyof Scores; label: string }[] = [
  { key: "satisfy", label: "답 만족" },
  { key: "trust", label: "근거 신뢰" },
  { key: "worthWait", label: "기다릴 만했나" },
  { key: "agentic", label: "알아서 해냈다" },
]
const PAIR_LABEL: Record<Pair, string> = {
  "N0-A1": "N0 vs A1 (주)",
  "N0-R": "N0 vs R",
  "A1-WK": "A1 vs WK",
}

type Step = { label: string; detail?: string }
type Phase = "idle" | "running" | "done"
type PartialScores = Partial<Scores>

const emptySteps = (): Record<Side, Step[]> => ({ A: [], B: [] })

/**
 * 블라인드 A/B 평가 화면. 서버가 A/B 자리를 무작위로 정하고, 이 화면은 팔 이름을 모른다.
 * 먼저 끝난 쪽 답도 두 쪽이 다 끝날 때까지 보이지 않는다(서버가 함께 보낸다). 진행 단계는 중립 이름으로 보인다.
 */
export function AbLab({ initialStatus }: { initialStatus: LabStatus }) {
  const [status, setStatus] = useState(initialStatus)
  const [pair, setPair] = useState<Pair>(initialStatus.pairs.find((p) => p.ready)?.pair ?? "N0-A1")
  const [question, setQuestion] = useState("")
  const [qid, setQid] = useState<string | null>(null)
  const [setInfo, setSetInfo] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const [phase, setPhase] = useState<Phase>("idle")
  const [trialId, setTrialId] = useState<string | null>(null)
  const [steps, setSteps] = useState(emptySteps)
  const [finished, setFinished] = useState<Record<Side, boolean>>({ A: false, B: false })
  const [result, setResult] = useState<Record<Side, SideView> | null>(null)

  const [prefer, setPrefer] = useState<"A" | "B" | "tie" | null>(null)
  const [scores, setScores] = useState<Record<Side, PartialScores>>({ A: {}, B: {} })
  const [guessed, setGuessed] = useState("")
  const [note, setNote] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const pairStat = status.pairs.find((p) => p.pair === pair)
  const overBudget = status.spentKrw >= status.budgetKrw
  const complete = !!prefer && SIDES.every((s) => SCORE_ITEMS.every((i) => scores[s][i.key]))

  function resetTrial() {
    setPhase("idle")
    setTrialId(null)
    setSteps(emptySteps())
    setFinished({ A: false, B: false })
    setResult(null)
    setPrefer(null)
    setScores({ A: {}, B: {} })
    setGuessed("")
    setNote("")
  }

  async function pick(forPair: Pair = pair) {
    setPicking(true)
    try {
      const res = await fetch(apiUrl(`${API}?pick=${forPair}`))
      const data = (await res.json()) as { question?: { qid: string; q: string; left: number; file: string } | null; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.question) {
        toast.info("이 쌍에서 남은 문항이 없습니다. 직접 입력하거나 다른 쌍을 고르세요.")
        return
      }
      setQuestion(data.question.q)
      setQid(data.question.qid)
      setSetInfo(`${data.question.file} · ${data.question.qid} · 남은 문항 ${data.question.left}`)
    } catch (err) {
      toast.error(`문항을 뽑지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPicking(false)
    }
  }

  async function run() {
    resetTrial()
    setPhase("running")
    try {
      const res = await fetch(apiUrl(API), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "run", question, qid: qid ?? undefined, pair }),
      })
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      let gotResult = false
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const e = JSON.parse(line) as TrialEvent
          if (e.type === "start") setTrialId(e.trialId)
          else if (e.type === "step") setSteps((s) => ({ ...s, [e.side]: [...s[e.side], { label: e.label, detail: e.detail }] }))
          else if (e.type === "finished") setFinished((f) => ({ ...f, [e.side]: true }))
          else if (e.type === "result") {
            gotResult = true
            setResult(e.sides)
            setStatus((st) => ({ ...st, spentKrw: e.spentKrw }))
            setPhase("done")
          } else if (e.type === "error") throw new Error(e.message)
        }
      }
      if (!gotResult) throw new Error("응답이 중간에 끊겼습니다")
    } catch (err) {
      setPhase("idle")
      toast.error(`실행하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function submit() {
    if (!trialId || !complete) return
    setSubmitting(true)
    try {
      const res = await fetch(apiUrl(API), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "vote", trialId, prefer, scores, guessed: guessed || undefined, note: note || undefined }),
      })
      const data = (await res.json()) as { status?: LabStatus; error?: string }
      if (!res.ok || !data.status) throw new Error(data.error ?? `HTTP ${res.status}`)
      setStatus(data.status)
      toast.success("평가를 남겼습니다")
      next()
    } catch (err) {
      toast.error(`평가를 남기지 못했습니다: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  /** 다음 문항 — 세트에서 뽑아 왔으면 다음 것도 뽑는다 */
  function next() {
    const fromSet = qid !== null
    resetTrial()
    setQuestion("")
    setQid(null)
    setSetInfo(null)
    if (fromSet) void pick()
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">블라인드 A/B 평가</h1>
          <p className="text-xs text-muted-foreground">로컬 dev · 관리자 전용. A/B 자리는 실행마다 무작위로 바뀝니다.</p>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
          이 쌍 {pairStat?.votes ?? 0} / {status.goal} · 전체 {status.totalVotes}건 · 누적 {status.spentKrw.toFixed(0)}원 / {status.budgetKrw.toLocaleString()}원
        </p>
      </header>

      {/* 질문 · 비교 쌍 */}
      <section aria-labelledby="ab-question" className="mb-5 rounded-xl border bg-card p-4">
        <h2 id="ab-question" className="sr-only">질문</h2>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label htmlFor="ab-pair" className="text-sm font-medium">비교 쌍</label>
          <NativeSelect
            id="ab-pair"
            value={pair}
            disabled={phase === "running"}
            onChange={(e) => {
              setPair(e.target.value as Pair)
              resetTrial()
            }}
            className="[&_select]:pointer-coarse:min-h-[44px]"
          >
            {status.pairs.map((p) => (
              <NativeSelectOption key={p.pair} value={p.pair} disabled={!p.ready}>
                {PAIR_LABEL[p.pair]}{p.ready ? "" : " — 준비 안 됨"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button variant="outline" className="touch-target" onClick={() => pick()} disabled={picking || phase === "running"}>
            {picking && <Spinner />}세트에서 뽑기
          </Button>
        </div>
        <label htmlFor="ab-q" className="sr-only">질문</label>
        <Textarea
          id="ab-q"
          value={question}
          disabled={phase === "running"}
          onChange={(e) => {
            setQuestion(e.target.value)
            setQid(null)
            setSetInfo(null)
          }}
          placeholder="질문을 입력하거나 「세트에서 뽑기」 를 누르세요"
          className="min-h-20"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {setInfo ?? "직접 입력한 질문"}
          </p>
          <Button
            className="touch-target"
            onClick={run}
            disabled={!question.trim() || phase === "running" || !pairStat?.ready || overBudget}
          >
            {phase === "running" && <Spinner />}
            {overBudget ? "예산 상한" : "두 쪽 실행"}
          </Button>
        </div>
      </section>

      {/* A / B */}
      <section aria-label="두 답" className="mb-5 grid gap-4 md:grid-cols-2">
        {SIDES.map((side) => (
          <SidePanel key={side} side={side} phase={phase} steps={steps[side]} finished={finished[side]} view={result?.[side]} />
        ))}
      </section>

      {/* 평가 */}
      {phase === "done" && result && (
        <section aria-labelledby="ab-vote" className="rounded-xl border bg-card p-4">
          <h2 id="ab-vote" className="mb-3 text-sm font-semibold">평가</h2>

          <fieldset className="mb-4">
            <legend className="mb-2 text-sm">어느 쪽이 나은가요?</legend>
            <div className="flex flex-wrap gap-2">
              {(["A", "B", "tie"] as const).map((v) => (
                <Button
                  key={v}
                  variant={prefer === v ? "default" : "outline"}
                  aria-pressed={prefer === v}
                  className="touch-target min-w-16"
                  onClick={() => setPrefer(v)}
                >
                  {v === "tie" ? "비슷" : v}
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="mb-4 grid gap-4 md:grid-cols-2">
            {SIDES.map((side) => (
              <fieldset key={side} className="min-w-0">
                <legend className="mb-2 text-sm font-medium">{side} 쪽 (1 낮음 ~ 5 높음)</legend>
                <div className="space-y-2">
                  {SCORE_ITEMS.map((item) => (
                    <div key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span id={`ab-${side}-${item.key}`} className="w-full text-xs text-muted-foreground sm:w-24">{item.label}</span>
                      <div role="group" aria-labelledby={`ab-${side}-${item.key}`} className="flex flex-wrap gap-1">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const on = scores[side][item.key] === n
                          return (
                            <Button
                              key={n}
                              size="sm"
                              variant={on ? "default" : "outline"}
                              aria-pressed={on}
                              aria-label={`${side} ${item.label} ${n}점`}
                              className="touch-target w-9 tabular-nums"
                              onClick={() => setScores((s) => ({ ...s, [side]: { ...s[side], [item.key]: n } }))}
                            >
                              {n}
                            </Button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="mb-4 grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor="ab-guess" className="mb-1 block text-xs text-muted-foreground">팔을 짐작했다면 (예: A=에이전트 같음)</label>
              <Textarea id="ab-guess" value={guessed} onChange={(e) => setGuessed(e.target.value)} maxLength={200} />
            </div>
            <div className="min-w-0">
              <label htmlFor="ab-note" className="mb-1 block text-xs text-muted-foreground">메모</label>
              <Textarea id="ab-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="touch-target" onClick={next} disabled={submitting}>
              평가 없이 넘기기
            </Button>
            <Button className="touch-target" onClick={submit} disabled={!complete || submitting}>
              {submitting && <Spinner />}제출하고 다음 문항
            </Button>
          </div>
          {!complete && <p className="mt-2 text-right text-xs text-muted-foreground">선호와 두 쪽 네 항목을 모두 고르면 제출할 수 있습니다.</p>}
        </section>
      )}
    </main>
  )
}

function SidePanel({ side, phase, steps, finished, view }: { side: Side; phase: Phase; steps: Step[]; finished: boolean; view?: SideView }) {
  return (
    <article aria-labelledby={`ab-side-${side}`} className="flex min-w-0 flex-col rounded-xl border bg-card p-4">
      <h2 id={`ab-side-${side}`} className="mb-2 text-base font-semibold">{side}</h2>

      {phase === "idle" ? (
        <p className="py-6 text-center text-sm text-muted-foreground">실행하면 여기에 진행 단계와 답이 나옵니다.</p>
      ) : (
        <ol aria-label={`${side} 진행 단계`} aria-live="polite" className="mb-3 space-y-1 text-xs text-muted-foreground">
          {steps.length === 0 && phase === "running" && !finished && <li>생각하는 중…</li>}
          {steps.map((s, i) => (
            <li key={i} className="flex min-w-0 gap-1.5">
              <span className="shrink-0 tabular-nums">{i + 1}.</span>
              <span className="shrink-0 font-medium text-foreground">{s.label}</span>
              {s.detail && <span className="min-w-0 truncate" title={s.detail}>{s.detail}</span>}
            </li>
          ))}
        </ol>
      )}

      {phase === "running" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner />
          {finished ? "끝남 — 다른 쪽 기다리는 중" : "진행 중"}
        </p>
      )}

      {view && (
        <div className="min-w-0 border-t pt-3">
          {view.failed && <p className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">{view.failed}</p>}
          {view.answer ? (
            <div className="break-keep [overflow-wrap:anywhere]">
              <OmnisMarkdown text={view.answer} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">답이 비어 있습니다.</p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground tabular-nums">
            {view.sec.toFixed(1)}초 · {view.krw.toFixed(1)}원
          </p>
        </div>
      )}
    </article>
  )
}
