"use client"

import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { PURPOSES, PURPOSE_LABEL, answerText, type AnswerValues, type FieldAnswer, type Purpose, type Turn } from "@/lib/ai-survey/rules"
import type { SurveyEvent, SurveyState } from "@/lib/ai-survey/service"
import { SurveyField, isAnswered } from "./survey-field"
import { SurveyMetrics } from "./survey-metrics"

/** 세 목적 충족도 막대 — 설문이 얼마나 남았는지 */
function CoverageBars({ coverage }: { coverage: Record<Purpose, number> }) {
  return (
    <div data-survey-coverage className="grid grid-cols-3 items-end gap-3">
      {PURPOSES.map((p) => (
        <div key={p} className="flex min-w-0 flex-col gap-1">
          {/* 좁은 화면(200px)에서는 이름이 줄을 바꾼다 — 말줄임으로 자르지 않는다 */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[12px]">
            <span className="break-keep text-muted-foreground">{PURPOSE_LABEL[p]}</span>
            <span className="tabular-nums">{coverage[p]}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={PURPOSE_LABEL[p]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage[p]} data-purpose={p}>
            <div className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${coverage[p]}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 지난 문답 — 접어 둔다. 원문 그대로 */
function History({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return null
  return (
    <details data-survey-history className="rounded-lg border px-3 py-1">
      <summary className="touch-target flex cursor-pointer list-none items-center text-[13px] text-muted-foreground">지난 답 {turns.length}개 보기</summary>
      <ol className="flex flex-col gap-2 pb-2">
        {turns.map((t, i) => (
          <li key={t.id} className="text-[13px] break-keep">
            <span className="text-muted-foreground">{i + 1}. {t.ask.question}</span>
            <br />
            <span className="font-medium">{t.ask.fields.map((f) => `${f.label ? `${f.label}: ` : ""}${answerText(f, t.answer?.[f.id])}`).join(" / ")}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}

/**
 * AI 활용 설문 — 한 번에 질문 하나와 그 질문에 맞는 입력 폼. 정해진 문항 없이 서버(에이전트)가 다음 질문을 만든다.
 * 응답은 보낼 때마다 저장돼 언제든 이어서 한다. 질문이 만들어지는 동안에는 글자가 흘러 들어온다.
 */
export function AiSurvey({ initial }: { initial: SurveyState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  /** 만들어지는 중인 질문 글 */
  const [incoming, setIncoming] = useState("")
  const [draft, setDraft] = useState<AnswerValues>({})
  const [confirmReset, setConfirmReset] = useState(false)
  // 같은 순간 두 번 눌러도 한 번만 보낸다 — 상태는 다음 그리기에야 바뀐다
  const lock = useRef(false)
  /** 지금 질문을 받기까지 화면에서 잰 시간 — 그 질문의 응답과 함께 보낸다 */
  const seen = useRef<{ turnId: string; first: number; ready: number } | null>(null)

  const current = state.turns.at(-1)
  const pending = current && !current.answer ? current : null
  const answered = state.turns.filter((t) => t.answer)

  const advance = useCallback(async (answer?: { turnId: string; values: AnswerValues }) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setIncoming("")
    const t0 = performance.now()
    let first: number | null = null
    try {
      const res = await fetch("/api/ai-survey/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(answer ? { answer } : {}), ...(answer && seen.current?.turnId === answer.turnId ? { seen: seen.current } : {}) }),
      })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `질문을 받지 못했어요 (${res.status})`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      for (;;) {
        const { done, value } = await reader.read()
        buf += decoder.decode(value, { stream: !done })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const e = JSON.parse(line) as SurveyEvent
          if (e.t === "coverage") setState((s) => ({ ...s, coverage: e.coverage }))
          else if (e.t === "q") {
            first ??= performance.now() - t0
            setIncoming(e.text)
          } else if (e.t === "state") {
            const ready = performance.now() - t0
            const last = e.state.turns.at(-1)
            if (last && !last.answer) seen.current = { turnId: last.id, first: Math.round(first ?? ready), ready: Math.round(ready) }
            setDraft({})
            setState(e.state)
          } else if (e.t === "error") {
            toast.error(e.error)
            // 다른 탭에서 나아갔으면 지금 상태를 다시 읽는다
            if (e.status === 409) {
              const fresh = await fetch("/api/ai-survey").then((r) => (r.ok ? (r.json() as Promise<SurveyState>) : null)).catch(() => null)
              if (fresh) setState(fresh)
            }
          }
        }
        if (done) break
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "질문을 받지 못했어요")
    } finally {
      lock.current = false
      setBusy(false)
      setIncoming("")
    }
  }, [])

  const submit = async () => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const res = await fetch("/api/ai-survey/submit", { method: "POST" })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `제출하지 못했어요 (${res.status})`)
      setState(body as SurveyState)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "제출하지 못했어요")
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const reset = async () => {
    setConfirmReset(false)
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const res = await fetch("/api/ai-survey", { method: "DELETE" })
      if (!res.ok) throw new Error(`지우지 못했어요 (${res.status})`)
      seen.current = null
      setDraft({})
      setState({ status: "NONE", turns: [], coverage: { usage: 0, tasks: 0, wishes: 0 }, summary: null, metrics: null, submittedAt: null })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "지우지 못했어요")
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const setField = (turn: Turn, fieldId: string, a: FieldAnswer | undefined, sendNow: boolean) => {
    const apply = (d: AnswerValues) => {
      const next = { ...d }
      if (a) next[fieldId] = a
      else delete next[fieldId]
      return next
    }
    // 한 번의 누름에 두 번 불릴 수 있다(슬라이더) — 앞 값을 받아 고친다
    setDraft(apply)
    // 칸이 하나뿐인 고르기 질문은 누르는 즉시 넘어간다
    if (sendNow && a) void advance({ turnId: turn.id, values: apply(draft) })
  }

  const resetDialog = (
    <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>처음부터 다시 할까요?</AlertDialogTitle>
          <AlertDialogDescription>지금까지 답한 내용{state.status === "SUBMITTED" ? "과 제출한 결과" : ""}이 지워집니다.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
          <AlertDialogAction className="touch-target" onClick={() => void reset()}>다시 하기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  const resetButton = (
    <Button type="button" variant="ghost" className="touch-target text-muted-foreground" disabled={busy} onClick={() => setConfirmReset(true)}>
      처음부터 다시
    </Button>
  )

  if (state.status === "NONE") {
    return (
      <section data-ai-survey="intro" className="flex flex-col gap-4">
        <h1 className="text-[20px] font-semibold break-keep">AI 를 어떻게 쓰고 계신지 알려 주세요</h1>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-muted-foreground break-keep">
          <li>얼마나 쓰는지 · 어떤 일에 쓰는지 · 옴니스가 해 주면 좋겠는 일, 세 가지를 묻습니다.</li>
          <li>글을 쓰지 않고 눌러서 답합니다. 2~3분이면 끝나고, 중간에 나가도 이어서 할 수 있어요.</li>
          <li>답한 내용은 회사 AI 예산과 옴니스 기능을 정하는 데 씁니다. 원문은 본인과 관리자만 봅니다.</li>
        </ul>
        <Button type="button" size="lg" className="touch-target self-start px-5 text-[15px]" disabled={busy} onClick={() => void advance()}>
          {busy ? <Spinner /> : null}
          시작하기
        </Button>
        {busy && <Waiting incoming={incoming} />}
      </section>
    )
  }

  if (state.status === "CONFIRM" || state.status === "SUBMITTED") {
    const done = state.status === "SUBMITTED"
    return (
      <section data-ai-survey={done ? "submitted" : "confirm"} className="flex flex-col gap-4">
        <CoverageBars coverage={state.coverage} />
        <h1 className="text-[20px] font-semibold break-keep">{done ? "제출했습니다. 고맙습니다" : "이렇게 이해했어요. 맞나요?"}</h1>
        {state.summary && <p data-survey-summary className="rounded-lg bg-muted/60 p-3 text-[14px] leading-relaxed break-keep">{state.summary}</p>}
        {state.metrics && <SurveyMetrics metrics={state.metrics} turns={state.turns} />}
        <History turns={answered} />
        <div className="flex flex-wrap items-center gap-2">
          {!done && (
            <Button type="button" size="lg" className="touch-target px-5 text-[15px]" disabled={busy} onClick={() => void submit()}>
              {busy ? <Spinner /> : null}
              맞아요, 제출
            </Button>
          )}
          {resetButton}
        </div>
        {resetDialog}
      </section>
    )
  }

  const ready = pending ? pending.ask.fields.every((f) => isAnswered(f, draft[f.id])) : false
  const instant = pending?.ask.fields.length === 1 && pending.ask.fields[0].kind === "single"

  return (
    <section data-ai-survey="asking" className="flex flex-col gap-4">
      <CoverageBars coverage={state.coverage} />
      <History turns={answered} />
      {busy ? (
        <Waiting incoming={incoming} />
      ) : pending ? (
        <form
          data-survey-turn={pending.id}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) void advance({ turnId: pending.id, values: draft })
          }}
        >
          <h1 data-survey-question className="text-[19px] leading-snug font-semibold break-keep">{pending.ask.question}</h1>
          {pending.ask.fields.map((f) => (
            <SurveyField key={`${pending.id}:${f.id}`} field={f} value={draft[f.id]} onChange={(a, picked) => setField(pending, f.id, a, instant && picked)} />
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="lg" className="touch-target px-5 text-[15px]" disabled={!ready}>다음</Button>
            {resetButton}
          </div>
        </form>
      ) : (
        // 질문을 받다가 끊긴 자리 — 답은 저장돼 있다
        <div className="flex flex-col items-start gap-3">
          <p className="text-[14px] text-muted-foreground">답한 곳까지 저장돼 있어요.</p>
          <Button type="button" size="lg" className="touch-target px-5 text-[15px]" onClick={() => void advance()}>이어서 하기</Button>
        </div>
      )}
      {resetDialog}
    </section>
  )
}

/** 다음 질문을 기다리는 자리 — 글자가 오면 바로 보이고, 폼 자리는 뼈대로 잡아 둔다 */
function Waiting({ incoming }: { incoming: string }) {
  return (
    <div data-survey-waiting className="flex flex-col gap-4" aria-live="polite" aria-busy="true">
      {incoming ? (
        <p className="text-[19px] leading-snug font-semibold break-keep">{incoming}</p>
      ) : (
        <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Spinner /> 다음 질문을 준비하고 있어요</p>
      )}
      <div className="flex flex-wrap gap-2">
        {[92, 120, 76, 104].map((w) => <Skeleton key={w} className="h-[44px] rounded-full" style={{ width: w }} />)}
      </div>
    </div>
  )
}
