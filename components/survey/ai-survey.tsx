"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { MESSAGE_ENTER } from "@/components/chat/message-list"
import { OmnisAvatar } from "@/components/messenger/omnis-room"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PURPOSES, PURPOSE_LABEL, answerText, type AnswerValues, type FieldAnswer, type Purpose, type Turn } from "@/lib/ai-survey/rules"
import type { SurveyEvent, SurveyState } from "@/lib/ai-survey/service"
import { cn } from "@/lib/utils"
import { SurveyField, isAnswered } from "./survey-field"
import { SurveyMetrics } from "./survey-metrics"

/** 질문이 너무 빨리 와도(준비된 질문) 이만큼은 「쓰는 중」 을 보인다 — 말풍선이 번쩍 바뀌지 않게 */
const MIN_TYPING_MS = 450

/** 세 목적 충족도 — 대화 위에 얇게 붙어 있다 */
function CoverageBars({ coverage }: { coverage: Record<Purpose, number> }) {
  return (
    <div className="shrink-0 border-b bg-background">
    <div data-survey-coverage className="mx-auto grid w-full max-w-[720px] grid-cols-3 items-end gap-3 px-4 py-2 sm:px-6">
      {PURPOSES.map((p) => (
        <div key={p} className="flex min-w-0 flex-col gap-1">
          {/* 좁은 화면(200px)에서는 이름이 줄을 바꾼다 — 말줄임으로 자르지 않는다 */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-1 text-[11.5px] leading-tight">
            <span className="break-keep text-muted-foreground">{PURPOSE_LABEL[p]}</span>
            <span className="tabular-nums">{coverage[p]}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={PURPOSE_LABEL[p]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage[p]} data-purpose={p}>
            <div className="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${coverage[p]}%` }} />
          </div>
        </div>
      ))}
    </div>
    </div>
  )
}

/** 옴니스가 한 말 — 옴니스 채팅과 같은 얼굴 · 이름 줄. 말풍선(테두리 · 배경) 없이 본문만 놓는다(ux-rules 「메신저」) */
function OmnisSays({ children, fresh = false, ...rest }: { children: ReactNode; fresh?: boolean } & Record<`data-${string}`, string | undefined>) {
  return (
    <div className={cn("mt-6 flex gap-3", fresh && MESSAGE_ENTER)} {...rest}>
      <OmnisAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[15.5px] font-semibold">옴니스</div>
        <div className="min-w-0 text-[17px] leading-[1.6] break-keep [overflow-wrap:anywhere]">{children}</div>
      </div>
    </div>
  )
}

/** 쓰는 중 — 점 셋 */
function TypingDots() {
  return (
    <span data-survey-typing role="status" aria-label="옴니스가 쓰는 중" className="inline-flex h-[27px] items-center gap-1">
      {[0, 150, 300].map((d) => (
        <span key={d} className="size-[7px] animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

/** 내가 고른 답 — 옴니스 채팅의 내 말풍선과 같은 모양. 누르면 그 답을 고친다 */
function MyAnswer({ text, onEdit, hint, fresh, sending }: { text: string; onEdit?: () => void; hint?: boolean; fresh?: boolean; sending?: boolean }) {
  const bubble = "max-w-[85%] whitespace-pre-wrap break-keep rounded-[24px] rounded-br-lg bg-primary/10 px-[18px] py-[12px] text-left text-[17px] leading-[1.6] [overflow-wrap:anywhere]"
  return (
    <div data-survey-answer className={cn("mt-5 flex flex-col items-end gap-1", fresh && MESSAGE_ENTER)}>
      {onEdit ? (
        <button type="button" onClick={onEdit} aria-label={`내 답 고치기: ${text}`} className={cn(bubble, "transition-colors hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
          {text}
        </button>
      ) : (
        <div className={cn(bubble, sending && "opacity-60")}>{text}</div>
      )}
      {/* 안내는 가장 최근 답 아래 한 번만 — 답마다 붙이면 대화가 길어진다 */}
      {onEdit && hint && <span className="text-[12.5px] text-muted-foreground">답을 누르면 고칠 수 있어요</span>}
    </div>
  )
}

const turnAnswer = (t: Turn, values: AnswerValues | undefined) => t.ask.fields.map((f) => `${f.label ? `${f.label}: ` : ""}${answerText(f, values?.[f.id])}`).join("\n")

/**
 * AI 활용 설문 — 옴니스와 주고받는 대화처럼 보인다. 질문은 왼쪽에 옴니스의 말로 하나씩 나타나고,
 * 고른 답은 오른쪽 내 말풍선으로 쌓인다. 입력 폼(칩 · 슬라이더 · 숫자)은 입력창 자리(아래)에 뜬다.
 * 정해진 문항 없이 서버(에이전트)가 다음 질문을 만들고, 응답은 보낼 때마다 저장돼 언제든 이어서 한다.
 */
export function AiSurvey({ initial }: { initial: SurveyState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  /** 다음 질문을 기다리는 중 — 이때만 옴니스의 「쓰는 중」 이 보인다(제출 · 고치기 때는 아니다) */
  const [asking, setAsking] = useState(false)
  /** 만들어지는 중인 질문 글 */
  const [incoming, setIncoming] = useState("")
  /** 보냈지만 아직 서버 상태에 없는 내 답 — 바로 말풍선으로 보인다 */
  const [sent, setSent] = useState<string | null>(null)
  const [draft, setDraft] = useState<AnswerValues>({})
  const [confirmReset, setConfirmReset] = useState(false)
  /** 고치려고 누른 답의 질문 */
  const [editing, setEditing] = useState<Turn | null>(null)
  /** 이번에 새로 나타난 말 — 그것만 떠오른다 */
  const [freshId, setFreshId] = useState<string | null>(null)
  // 같은 순간 두 번 눌러도 한 번만 보낸다 — 상태는 다음 그리기에야 바뀐다
  const lock = useRef(false)
  /** 지금 질문을 받기까지 화면에서 잰 시간 — 그 질문의 응답과 함께 보낸다 */
  const seen = useRef<{ turnId: string; first: number; ready: number } | null>(null)
  const thread = useRef<HTMLDivElement>(null)

  const current = state.turns.at(-1)
  const pending = current && !current.answer ? current : null
  const done = state.status === "SUBMITTED"
  const closing = state.status === "CONFIRM" || done
  const lastAnswered = state.turns.findLast((t) => t.answer)

  // 새 말이 나타나면 대화를 맨 아래로 — 입력 폼의 높이가 바뀔 때도
  useEffect(() => {
    const el = thread.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [state.turns.length, state.status, busy, incoming, sent, pending?.id])

  const advance = useCallback(async (answer?: { turnId: string; values: AnswerValues }, said?: string) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setAsking(true)
    setIncoming("")
    setSent(said ?? null)
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
        const { done: end, value } = await reader.read()
        buf += decoder.decode(value, { stream: !end })
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
            // 대기 시간은 서버가 준 때로 잰다 — 아래의 짧은 「쓰는 중」 은 재지 않는다
            const ready = performance.now() - t0
            const last = e.state.turns.at(-1)
            if (last && !last.answer) seen.current = { turnId: last.id, first: Math.round(first ?? ready), ready: Math.round(ready) }
            if (ready < MIN_TYPING_MS) await new Promise((r) => setTimeout(r, MIN_TYPING_MS - ready))
            setDraft({})
            setFreshId(last?.id ?? null)
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
        if (end) break
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "질문을 받지 못했어요")
    } finally {
      lock.current = false
      setBusy(false)
      setAsking(false)
      setIncoming("")
      setSent(null)
    }
  }, [])

  /** 잠그고 한 번 부른다 — 제출 · 다시 하기 · 답 고치기 */
  const call = async (run: () => Promise<SurveyState>, fail: string) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      seen.current = null
      setDraft({})
      setFreshId(null)
      setState(await run())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fail)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const post = async (url: string, fail: string, body?: object): Promise<SurveyState> => {
    const res = await fetch(url, { method: "POST", ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error ?? `${fail} (${res.status})`)
    return json as SurveyState
  }
  const submit = () => call(() => post("/api/ai-survey/submit", "제출하지 못했어요"), "제출하지 못했어요")
  const rewind = (turn: Turn) => {
    setEditing(null)
    return call(() => post("/api/ai-survey/rewind", "고치지 못했어요", { turnId: turn.id }), "고치지 못했어요")
  }
  const reset = () => {
    setConfirmReset(false)
    return call(async () => {
      const res = await fetch("/api/ai-survey", { method: "DELETE" })
      if (!res.ok) throw new Error(`지우지 못했어요 (${res.status})`)
      return { status: "NONE", turns: [], coverage: { usage: 0, tasks: 0, wishes: 0 }, summary: null, metrics: null, submittedAt: null }
    }, "지우지 못했어요")
  }

  const send = (turn: Turn, values: AnswerValues) => void advance({ turnId: turn.id, values }, turnAnswer(turn, values))

  const setField = (turn: Turn, fieldId: string, a: FieldAnswer | undefined, sendNow: boolean) => {
    const apply = (d: AnswerValues) => {
      const next = { ...d }
      if (a) next[fieldId] = a
      else delete next[fieldId]
      return next
    }
    // 한 번의 누름에 두 번 불릴 수 있다(슬라이더) — 앞 값을 받아 고친다
    setDraft(apply)
    // 칸이 하나뿐인 고르기 질문은 누르는 즉시 보낸다
    if (sendNow && a) send(turn, apply(draft))
  }

  const ready = pending ? pending.ask.fields.every((f) => isAnswered(f, draft[f.id])) : false
  const instant = pending?.ask.fields.length === 1 && pending.ask.fields[0].kind === "single"
  const resetButton = (
    <Button type="button" variant="ghost" className="touch-target text-muted-foreground" disabled={busy} onClick={() => setConfirmReset(true)}>
      처음부터 다시
    </Button>
  )
  const primary = "touch-target h-[44px] rounded-full px-5 text-[15px]"

  /** 입력창 자리 — 지금 할 수 있는 것 하나 */
  let dock: ReactNode
  if (state.status === "NONE") {
    dock = (
      <Button type="button" className={primary} disabled={busy} onClick={() => void advance()}>
        {busy ? <Spinner /> : null}
        시작하기
      </Button>
    )
  } else if (closing) {
    dock = (
      <>
        {!done && (
          <Button type="button" className={primary} disabled={busy} onClick={() => void submit()}>
            {busy ? <Spinner /> : null}
            맞아요, 제출
          </Button>
        )}
        {resetButton}
      </>
    )
  } else if (busy) {
    dock = <span className="flex h-[44px] items-center gap-2 text-[14px] text-muted-foreground">{asking ? "옴니스가 다음 질문을 쓰고 있어요" : <Spinner />}</span>
  } else if (pending) {
    dock = (
      <form
        data-survey-turn={pending.id}
        className="flex w-full flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) send(pending, draft)
        }}
      >
        {pending.ask.fields.map((f) => (
          <SurveyField key={`${pending.id}:${f.id}`} field={f} value={draft[f.id]} onChange={(a, picked) => setField(pending, f.id, a, instant && picked)} />
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" className={primary} disabled={!ready}>보내기</Button>
          {resetButton}
        </div>
      </form>
    )
  } else {
    // 질문을 받다가 끊긴 자리 — 답은 저장돼 있다
    dock = <Button type="button" className={primary} onClick={() => void advance()}>이어서 하기</Button>
  }

  return (
    <section data-ai-survey={state.status === "NONE" ? "intro" : done ? "submitted" : state.status === "CONFIRM" ? "confirm" : "asking"} data-messenger className="flex min-h-0 flex-1 flex-col">
      <CoverageBars coverage={state.coverage} />

      <div ref={thread} role="log" aria-label="설문 대화" data-survey-thread className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pb-5 sm:px-6">
          <OmnisSays data-survey-intro="">
            안녕하세요. AI 를 어떻게 쓰고 계신지 몇 가지 여쭤볼게요.
            <div className="mt-1.5 text-[15px] text-muted-foreground">
              얼마나 쓰는지 · 어떤 일에 쓰는지 · 옴니스가 해 주면 좋겠는 일, 세 가지예요. 글을 쓰지 않고 눌러서 답하고, 2~3분이면 끝나요. 중간에 나가도 이어서 할 수 있어요.
              답은 회사 AI 예산과 옴니스 기능을 정하는 데 쓰고, 원문은 본인과 관리자만 봅니다.
            </div>
          </OmnisSays>

          {state.turns.map((t) => (
            <div key={t.id} className="contents">
              <OmnisSays fresh={t.id === freshId} {...(t === pending ? { "data-survey-question": "" } : {})}>{t.ask.question}</OmnisSays>
              {t.answer && <MyAnswer text={turnAnswer(t, t.answer)} hint={t === lastAnswered} onEdit={done || busy ? undefined : () => setEditing(t)} />}
            </div>
          ))}

          {sent && <MyAnswer text={sent} fresh sending />}
          {asking && !closing && (
            <OmnisSays fresh data-survey-waiting="">{incoming || <TypingDots />}</OmnisSays>
          )}

          {closing && (
            <OmnisSays fresh={freshId !== null} data-survey-closing="">
              {done ? "제출했습니다. 고맙습니다." : "이렇게 이해했어요. 맞나요?"}
              {state.summary && <div data-survey-summary className="mt-3 rounded-2xl bg-muted/60 px-4 py-3 text-[15px] leading-relaxed">{state.summary}</div>}
              {state.metrics && (
                <div className="mt-3">
                  <SurveyMetrics metrics={state.metrics} turns={state.turns} />
                </div>
              )}
              {!done && <div className="mt-2 text-[14px] text-muted-foreground">고칠 답이 있으면 위에서 그 말풍선을 눌러 주세요.</div>}
            </OmnisSays>
          )}
        </div>
      </div>

      {/* 입력창 자리 — 폼이 길어도 화면 절반을 넘기지 않고 그 안에서 스크롤한다 */}
      <div data-survey-dock className="shrink-0 border-t bg-background">
        <div className="mx-auto flex max-h-[52vh] w-full max-w-[720px] flex-wrap items-center gap-2 overflow-y-auto px-4 py-3 sm:px-6">{dock}</div>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>처음부터 다시 할까요?</AlertDialogTitle>
            <AlertDialogDescription>지금까지 답한 내용{done ? "과 제출한 결과" : ""}이 지워집니다.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
            <AlertDialogAction className="touch-target" onClick={() => void reset()}>다시 하기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <AlertDialogContent data-survey-edit-confirm>
          <AlertDialogHeader>
            <AlertDialogTitle>이 답을 고칠까요?</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">{editing?.ask.question}</span>
              <span>이 질문으로 돌아가 다시 답합니다. 이 뒤에 한 답은 지워지고, 뒤 질문은 새 답에 맞춰 다시 나와요.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
            <AlertDialogAction className="touch-target" onClick={() => editing && void rewind(editing)}>고치기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
