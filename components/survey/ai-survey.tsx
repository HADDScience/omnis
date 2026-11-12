"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUp01Icon, Cancel01Icon, MoreHorizontalIcon, PencilEdit02Icon } from "@hugeicons/core-free-icons"

import { MESSAGE_ENTER } from "@/components/chat/message-list"
import { OmnisAvatar } from "@/components/messenger/omnis-room"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { SURVEY_CHANGED_EVENT } from "@/lib/ai-survey/entry"
import { FLAG_TEXT } from "@/lib/ai-survey/metrics"
import { PURPOSES, PURPOSE_LABEL, SAY_MAX, answerText, fieldMode, understoodText, type AnswerValues, type Field, type FieldAnswer, type Purpose } from "@/lib/ai-survey/rules"
import type { SurveyEvent, SurveyState, TurnView } from "@/lib/ai-survey/service"
import { startStep, stepNav } from "@/lib/ai-survey/steps"
import { enterSends, isTouchTyping } from "@/lib/enter-to-send"
import { cn } from "@/lib/utils"
import { SurveyField, isAnswered } from "./survey-field"
import { SurveyMetrics } from "./survey-metrics"

/** 질문이 너무 빨리 와도(준비된 질문) 이만큼은 「쓰는 중」 을 보인다 — 말풍선이 번쩍 바뀌지 않게 */
const MIN_TYPING_MS = 450

/** 세 목적 충족도 — 대화 위에 얇게 붙어 있다 */
function CoverageBars({ coverage, menu }: { coverage: Record<Purpose, number>; menu?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-background pr-2 sm:pr-4">
      <div data-survey-coverage className="mx-auto grid w-full max-w-[720px] min-w-0 flex-1 grid-cols-3 items-end gap-3 py-2 pl-4 sm:pl-6">
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
      {menu}
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

const turnAnswer = (t: TurnView, values: AnswerValues | undefined) => t.ask.fields.map((f) => `${f.label ? `${f.label}: ` : ""}${answerText(f, values?.[f.id])}`).join("\n")
const turnUnderstood = (t: TurnView) => t.ask.fields.map((f) => understoodText(t.answer?.[f.id])).filter(Boolean).join(", ")

/**
 * 내 답 — 옴니스 채팅의 내 말풍선과 같은 모양. 누르면 그 질문만 다시 답한다(대화는 그대로 둔다).
 * 고친 답은 「앞 답 → 새 답 · 수정됨」, 말로 한 답은 칸으로 옮긴 결과(「…로 이해했어요」), 앞 답이 바뀌어 안 쓰게 된 답은 흐리게.
 */
function MyAnswer({ turn, onEdit, active, hint }: { turn: TurnView; onEdit?: () => void; active?: boolean; hint?: boolean }) {
  const text = turnAnswer(turn, turn.answer)
  const understood = turnUnderstood(turn)
  const bubble = cn(
    "max-w-[85%] whitespace-pre-wrap break-keep rounded-[24px] rounded-br-lg bg-primary/10 px-[18px] py-[12px] text-left text-[17px] leading-[1.6] [overflow-wrap:anywhere]",
    turn.dead && "bg-muted text-muted-foreground line-through",
    active && "ring-2 ring-primary",
  )
  const body = (
    <>
      {turn.edited && !turn.dead && <span className="text-muted-foreground line-through">{turn.edited.from}</span>}
      {turn.edited && !turn.dead && <span aria-hidden className="text-muted-foreground"> → </span>}
      {text}
    </>
  )
  return (
    <div data-survey-answer={turn.id} data-edited={turn.edited ? "" : undefined} data-dead={turn.dead ? "" : undefined} className="mt-5 flex flex-col items-end gap-1">
      {onEdit ? (
        <button type="button" onClick={onEdit} aria-label={`내 답 고치기: ${text}`} className={cn(bubble, "transition-colors hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none")}>
          {body}
        </button>
      ) : (
        <div className={bubble}>{body}</div>
      )}
      {understood && !turn.dead && (
        <span data-survey-understood className="max-w-[85%] rounded-full border px-2.5 py-0.5 text-[12.5px] break-keep text-muted-foreground">「{understood}」로 이해했어요</span>
      )}
      {turn.edited && !turn.dead && <span data-survey-edited className="text-[12.5px] text-muted-foreground">수정됨</span>}
      {turn.dead && <span className="text-[12.5px] text-muted-foreground">앞 답이 바뀌어 이 답은 쓰지 않아요</span>}
      {/* 안내는 가장 최근 답 아래 한 번만 — 답마다 붙이면 대화가 길어진다 */}
      {onEdit && hint && !turn.edited && <span className="text-[12.5px] text-muted-foreground">답을 누르거나 말로 고칠 수 있어요</span>}
    </div>
  )
}

/** 고치기 시작할 때 폼에 채워 둘 값 — 지금의 답(폼으로 고른 것만. 말로 한 답은 다시 말하거나 칩을 누른다) */
function currentForm(turn: TurnView): AnswerValues {
  const out: AnswerValues = {}
  for (const f of turn.ask.fields) {
    const a = turn.answer?.[f.id]
    if (a && !("said" in a)) out[f.id] = a
  }
  return out
}

/** 범위 입력에 미리 맞춰 둘 값 — 글에서 읽은 숫자(서버가 눈금 · 구간에 맞춰 준다) */
function presetOf(f: Field, n: number | null): FieldAnswer | undefined {
  if (n === null) return undefined
  if (f.kind !== "bucket") return { num: n }
  const o = f.options?.find((x) => x.num === n)
  return o ? { choice: [o.id] } : undefined
}

/**
 * AI 활용 설문 — 옴니스와 주고받는 대화. 질문은 왼쪽에 옴니스의 말로 하나씩 나타나고 내 답은 오른쪽 말풍선으로 쌓인다.
 * 답하는 길은 두 갈래다: 범위 칸은 슬라이더 · 구간 칩으로만, 나머지는 입력창에 말로(추천 답 칩을 눌러도 된다).
 * 지난 답은 말풍선을 누르거나 「아까 4일 아니고 3일」 처럼 말해서 그 자리에서 고친다 — 대화를 되돌리지 않는다.
 */
export function AiSurvey({ initial }: { initial: SurveyState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  /** 다음 질문 · 답 읽기를 기다리는 중 — 이때만 옴니스의 「쓰는 중」 이 보인다(제출 · 다시 하기 때는 아니다) */
  const [asking, setAsking] = useState(false)
  /** 만들어지는 중인 질문 글 */
  const [incoming, setIncoming] = useState("")
  /** 보냈지만 아직 서버 상태에 없는 내 말 — 바로 말풍선으로 보인다 */
  const [sent, setSent] = useState<string | null>(null)
  /** 폼(범위 입력 · 추천 칩)에서 고르는 중인 값 — 지금 다루는 질문의 것 */
  const [draft, setDraft] = useState<AnswerValues>({})
  /** 입력창의 글 */
  const [text, setText] = useState("")
  /** 고치는 중인 지난 질문 */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 옴니스의 짧은 말(못 알아들었을 때) — 저장되지 않는다 */
  const [note, setNote] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  /** 요약 확인 화면의 「이 부분 고칠까요?」 를 「이대로 둘게요」 로 닫았다 — 한 번만 묻는다 */
  const [checkDismissed, setCheckDismissed] = useState(false)
  const checkFlags = state.metrics?.flags ?? []
  /** 제출한 뒤 「다시 하기」 를 골랐다 — 시작하면 새 응답이 생기고 앞 응답은 기록으로 남는다 */
  const restart = useRef(false)
  /** 이번에 새로 나타난 말 — 그것만 떠오른다 */
  const [freshId, setFreshId] = useState<string | null>(null)
  // 같은 순간 두 번 눌러도 한 번만 보낸다 — 상태는 다음 그리기에야 바뀐다
  const lock = useRef(false)
  /** 지금 질문을 받기까지 화면에서 잰 시간 — 그 질문의 응답과 함께 보낸다 */
  const seen = useRef<{ turnId: string; first: number; ready: number } | null>(null)
  const thread = useRef<HTMLDivElement>(null)
  /** 떠 있는 시트 — 그 높이만큼 대화 끝을 비운다 */
  const dockRef = useRef<HTMLDivElement>(null)
  const [dockH, setDockH] = useState(120)
  useEffect(() => {
    const el = dockRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDockH(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** 묶음 범위 질문에서 펼친 칸 — 「이전」 · 「다음」 으로만 바뀐다 */
  const [focusIdx, setFocusIdx] = useState(0)
  /** 말에서 읽은 값으로 맞춘 칸 — 그 질문을 펼칠 때 이 칸부터 보인다 */
  const focusField = useRef<string | null>(null)
  /** 연필 단추로 연 「고칠 답 말하기」 입력창 */
  const [fixOpen, setFixOpen] = useState(false)
  /** 한 번의 누름에 두 번 불리는 값(슬라이더) — 상태는 다음 그리기에야 바뀐다 */
  const draftRef = useRef<AnswerValues>({})

  const current = state.turns.at(-1)
  const pending = current && !current.answer ? current : null
  const done = state.status === "SUBMITTED"
  const closing = state.status === "CONFIRM" || done
  const editing = editingId ? state.turns.find((t) => t.id === editingId && t.answer) ?? null : null
  /** 지금 폼이 다루는 질문 — 고치는 중이면 그 질문, 아니면 묻는 질문 */
  const active = editing ?? pending
  const mode = active ? fieldMode(active.ask.fields[0]) : null
  const lastAnswered = state.turns.findLast((t) => t.answer && !t.dead)
  draftRef.current = draft
  // 다른 질문으로 넘어가면 첫 칸(말로 맞춘 칸이 있으면 그 칸)부터 펼치고 연필 입력창은 접는다
  const activeKey = `${active?.id ?? ""}:${editingId ?? ""}:${state.status}`
  const [seenKey, setSeenKey] = useState(activeKey)
  if (seenKey !== activeKey) {
    setSeenKey(activeKey)
    setFocusIdx(startStep(active?.ask.fields ?? [], focusField.current))
    focusField.current = null
    setFixOpen(false)
  }

  // 새 말이 나타나면 대화를 맨 아래로 — 입력 폼의 높이가 바뀔 때도
  /**
   * 맨 아래를 따라가는 중인가. 새 말이 오면 따라가기 시작하고, 사용자가 위로 올려 읽으면 멈춘다(맨 아래 80px 안으로 돌아오면 다시).
   * 시트 높이가 바뀌어도(새 질문의 칩이 그려짐 · 연필로 입력창을 엶 · 키보드) 따라가는 중이면 다시 맨 아래로 —
   * 새 질문이 온 순간에만 내리면, 그 뒤 시트가 커진 만큼 마지막 질문이 시트 뒤에 남았다(2026-11-12 폰 스크린샷)
   */
  const following = useRef(true)
  /** 우리가 내리는 중 — 부드러운 스크롤의 중간 위치를 「사용자가 올렸다」 로 읽지 않는다 */
  const pinnedUntil = useRef(0)
  const toBottom = useCallback((behavior: ScrollBehavior) => {
    const el = thread.current
    if (!el) return
    pinnedUntil.current = Date.now() + 800
    el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])
  useEffect(() => {
    following.current = true
    toBottom("smooth")
  }, [toBottom, state.turns.length, state.status, busy, incoming, sent, note, pending?.id])
  // 시트 높이가 바뀌면 대화 끝 여백(= 시트 높이)도 바뀐다 — 따라가는 중이면 곧바로 새 맨 아래로
  useEffect(() => {
    if (following.current) toBottom("auto")
  }, [toBottom, dockH])
  const onThreadScroll = () => {
    const el = thread.current
    if (!el || Date.now() < pinnedUntil.current) return
    following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const request = useCallback(async (body: object, said?: string) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setAsking(true)
    setIncoming("")
    setNote(null)
    setSent(said ?? null)
    const t0 = performance.now()
    let first: number | null = null
    try {
      const res = await fetch("/api/ai-survey/turn", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `질문을 받지 못했어요 (${res.status})`)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      /** 범위 입력을 이 값으로 맞춰 띄우라는 답 — 상태가 온 뒤에 연다 */
      let range: Extract<SurveyEvent, { t: "range" }> | null = null
      let failed = false
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
          } else if (e.t === "note") setNote(e.text)
          else if (e.t === "range") range = e
          else if (e.t === "state") {
            // 대기 시간은 서버가 준 때로 잰다 — 아래의 짧은 「쓰는 중」 은 재지 않는다
            const ready = performance.now() - t0
            const last = e.state.turns.at(-1)
            const asked = last && !last.answer && seen.current?.turnId !== last.id
            if (asked) {
              seen.current = { turnId: last.id, first: Math.round(first ?? ready), ready: Math.round(ready) }
              if (ready < MIN_TYPING_MS) await new Promise((r) => setTimeout(r, MIN_TYPING_MS - ready))
              setFreshId(last.id)
            }
            setState(e.state)
            if (range) {
              const turn = e.state.turns.find((t) => t.id === range!.turnId)
              const field = turn?.ask.fields.find((f) => f.id === range!.fieldId)
              const preset = field ? presetOf(field, range.num) : undefined
              setEditingId(turn?.answer ? turn.id : null)
              // 묶음 질문이면 다른 칸은 지금 답 그대로 두고 그 칸만 맞춘다 — 그 칸을 펼쳐 보인다
              setDraft({ ...(turn?.answer ? currentForm(turn) : {}), ...(preset && field ? { [field.id]: preset } : {}) })
              if (turn && field) {
                focusField.current = field.id
                setFocusIdx(startStep(turn.ask.fields, field.id))
              }
              // 글은 읽었다 — 남겨 두면 「보내기」 가 범위 입력 대신 그 글을 다시 보낸다
              setText("")
              setNote(turn?.answer ? "이 값으로 고칠까요? 아래에서 맞춰서 보내 주세요." : "아래에서 골라서 보내 주세요.")
            } else if (!failed) {
              setEditingId(null)
              setDraft({})
              setText("")
              setFixOpen(false)
            }
          } else if (e.t === "error") {
            failed = true
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

  /** 잠그고 한 번 부른다 — 제출 · 다시 하기 */
  const call = async (run: () => Promise<SurveyState>, fail: string) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    try {
      const next = await run()
      seen.current = null
      setDraft({})
      setText("")
      setEditingId(null)
      setNote(null)
      setFreshId(null)
      setState(next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fail)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const submit = () => call(async () => {
    const res = await fetch("/api/ai-survey/submit", { method: "POST" })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error ?? `제출하지 못했어요 (${res.status})`)
    // 맨 위 안내 띠 · 마이 화면 카드가 바뀐다
    window.dispatchEvent(new Event(SURVEY_CHANGED_EVENT))
    return json as SurveyState
  }, "제출하지 못했어요")
  const blank = (earlier: number): SurveyState => ({ status: "NONE", turns: [], coverage: { usage: 0, tasks: 0, wishes: 0 }, summary: null, metrics: null, submittedAt: null, earlier })
  const reset = () => {
    setConfirmReset(false)
    restart.current = true
    // 제출한 응답은 지우지 않는다(기록) — 새로 시작할 때 새 응답이 생긴다. 답하던 응답은 지운다
    if (done) return call(async () => blank((state.earlier ?? 0) + 1), "다시 시작하지 못했어요")
    return call(async () => {
      const res = await fetch("/api/ai-survey", { method: "DELETE" })
      if (!res.ok) throw new Error(`지우지 못했어요 (${res.status})`)
      return blank(state.earlier ?? 0)
    }, "지우지 못했어요")
  }

  /** 폼으로 고른 값을 보낸다 — 묻는 질문이면 답, 지난 질문이면 그 자리에서 고치기 */
  const sendForm = (turn: TurnView, values: AnswerValues) => {
    const body = { turnId: turn.id, values }
    if (turn.answer) return void request({ edit: body }, turnAnswer(turn, values))
    void request({ answer: body, ...(seen.current?.turnId === turn.id ? { seen: seen.current } : {}) }, turnAnswer(turn, values))
  }
  /** 입력창의 글을 보낸다 — 고른 추천 칩이 있으면 함께 말한 것으로 친다 */
  const sendText = () => {
    const typed = text.trim()
    if (!typed) return
    const picked = active && mode === "chat" ? active.ask.fields.flatMap((f) => { const a = draft[f.id]; return a && "choice" in a ? (f.options ?? []).filter((o) => a.choice.includes(o.id)).map((o) => o.label) : [] }) : []
    const said = [...picked, typed].join(", ").slice(0, SAY_MAX)
    void request({ say: { text: said, ...(editing ? { turnId: editing.id } : {}) } }, said)
  }
  const formReady = active ? active.ask.fields.every((f) => isAnswered(f, draft[f.id])) : false
  const send = () => {
    if (text.trim()) return sendText()
    if (active && formReady) sendForm(active, draft)
  }

  const instant = active?.ask.fields.length === 1 && (active.ask.fields[0].kind === "single" || active.ask.fields[0].kind === "bucket" || active.ask.fields[0].kind === "text")
  const setField = (turn: TurnView, fieldId: string, a: FieldAnswer | undefined, sendNow: boolean) => {
    const apply = (d: AnswerValues) => {
      const next = { ...d }
      if (a) next[fieldId] = a
      else delete next[fieldId]
      return next
    }
    // 한 번의 누름에 두 번 불릴 수 있다(슬라이더) — 앞 값을 받아 고친다
    setDraft(apply)
    draftRef.current = apply(draftRef.current)
    // 하나만 고르는 질문은 누르는 즉시 보낸다
    if (sendNow && a) sendForm(turn, apply(draft))
  }
  const startEdit = (turn: TurnView) => {
    setEditingId(turn.id)
    setDraft(currentForm(turn))
    setText("")
    setNote(null)
  }
  const cancelEdit = () => {
    setEditingId(null)
    setDraft({})
    setText("")
    setNote(null)
  }

  const primary = "touch-target h-[44px] shrink-0 rounded-full px-5 text-[15px]"
  const talking = state.status === "IN_PROGRESS" || state.status === "CONFIRM"
  /** 말로 고치는 입력창을 연다 — 범위 질문 · 요약 확인 중에는 연필 단추 뒤에 접어 둔다 */
  const typingOpen = mode === "chat" || fixOpen
  const placeholder = editing ? "다시 말하기" : mode === "chat" ? "직접 말하기" : "고칠 답 말하기"

  /**
   * 묶음 범위 질문 — 한 번에 한 칸만 보이고, 시트 아래 「이전」 · 「다음」 으로 오간다(마지막 칸은 「보내기」).
   * 슬라이더 · 칩을 만져도 저절로 넘어가지 않는다 — 손을 떼자마자 넘어가 값을 다시 볼 틈이 없었다(작업지시자 2026-11-12).
   * 고른 값은 질문 단위 draft 에 남아 「이전」 으로 돌아가면 그대로 보인다
   */
  const fields = active?.ask.fields ?? []
  const grouped = mode === "range" && fields.length > 1
  const nav = grouped ? stepNav(fields, draft, focusIdx) : null
  const openIdx = nav?.index ?? 0

  const sendButton = (
    <Button type="submit" size="icon" aria-label="보내기" className="touch-target size-[44px] shrink-0 rounded-full" disabled={!text.trim() && !formReady}>
      <HugeiconsIcon icon={ArrowUp01Icon} size={24} aria-hidden />
    </Button>
  )
  const fixButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={fixOpen ? "고칠 답 말하기 닫기" : "고칠 답 말하기"}
      aria-pressed={fixOpen}
      data-survey-fix
      className="touch-target size-[44px] shrink-0 rounded-full text-muted-foreground"
      onClick={() => {
        setFixOpen((v) => !v)
        setText("")
      }}
    >
      <HugeiconsIcon icon={fixOpen ? Cancel01Icon : PencilEdit02Icon} size={19} aria-hidden />
    </Button>
  )
  const input = (
    <textarea
      data-survey-input
      rows={1}
      autoFocus={fixOpen}
      aria-label="옴니스에게 말하기"
      placeholder={placeholder}
      maxLength={SAY_MAX}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (enterSends(e, isTouchTyping())) {
          e.preventDefault()
          send()
        }
      }}
      // 채팅 입력창과 같은 알약 — 글자는 16px 밑으로 내리지 않는다(iOS 확대 방지). placeholder 는 한 줄로 짧게
      className="max-h-[120px] min-h-[44px] min-w-0 flex-1 resize-none rounded-[22px] border border-transparent bg-background/70 px-4 py-[11px] text-[16px] leading-[22px] whitespace-pre-wrap shadow-[inset_0_0_0_1px_var(--glass-edge)] outline-none placeholder:truncate placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [field-sizing:content]"
    />
  )

  /** 떠 있는 시트 안 — 지금 할 수 있는 것 하나 */
  let dock: ReactNode
  if (state.status === "NONE") {
    dock = (
      <div className="flex justify-center">
        <Button type="button" className={primary} disabled={busy} onClick={() => void request(restart.current ? { restart: true } : {})}>
          {busy ? <Spinner /> : null}
          시작하기
        </Button>
      </div>
    )
  } else if (done) {
    dock = (
      <div className="flex justify-center">
        <Button type="button" variant="outline" className={primary} disabled={busy} onClick={() => setConfirmReset(true)}>다시 하기</Button>
      </div>
    )
  } else if (busy) {
    dock = <span className="flex h-[44px] items-center justify-center gap-2 text-[14px] text-muted-foreground">{asking ? "옴니스가 쓰고 있어요" : <Spinner />}</span>
  } else if (!active && !closing) {
    // 질문을 받다가 끊긴 자리 — 답은 저장돼 있다
    dock = (
      <div className="flex justify-center">
        <Button type="button" className={primary} onClick={() => void request({})}>이어서 하기</Button>
      </div>
    )
  } else {
    dock = (
      <form
        data-survey-turn={active?.id}
        data-survey-editing={editing ? "" : undefined}
        className="flex w-full flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        {editing && (
          <div className="flex items-center justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-muted-foreground"><span className="font-medium text-foreground">고치는 중</span> · {editing.ask.question}</span>
            <button type="button" onClick={cancelEdit} className="touch-hit shrink-0 underline underline-offset-4">취소</button>
          </div>
        )}
        {fields.map((f, i) =>
          grouped && i !== openIdx ? null : (
            <div key={`${active!.id}:${f.id}`} data-survey-step={grouped ? i + 1 : undefined} className="flex flex-col gap-1">
              {grouped && (
                <div className="flex items-center justify-between gap-2 px-1 text-[13px]">
                  <span className="min-w-0 truncate font-medium">{f.label}</span>
                  <span data-survey-step-count className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{i + 1} / {fields.length}</span>
                </div>
              )}
              <SurveyField field={f} value={draft[f.id]} hideLabel={grouped} onChange={(a, picked) => setField(active!, f.id, a, instant && picked)} />
            </div>
          ),
        )}
        <div className="flex items-end gap-2">
          {/* 범위 칸을 고치는 중에는 입력창을 두지 않는다 — 범위는 글로 확정하지 않는다 */}
          {talking && !(editing && mode === "range") && mode !== "chat" && fixButton}
          {talking && !(editing && mode === "range") && typingOpen ? input : <span className="flex-1" />}
          {closing && !editing && !fixOpen ? (
            <Button type="button" className={primary} disabled={busy} onClick={() => void submit()}>맞아요, 제출</Button>
          ) : nav && !fixOpen ? (
            // 묶음 질문 — 「이전」 · 「다음」, 마지막 칸은 「보내기」. 다음 · 보내기는 같은 단추라 누른 뒤에도 포커스가 남는다
            <>
              {nav.prev && (
                <Button type="button" variant="outline" className={cn(primary, "bg-background/70")} data-survey-step-prev onClick={() => setFocusIdx(nav.index - 1)}>
                  이전
                </Button>
              )}
              <Button
                type={nav.action === "send" ? "submit" : "button"}
                className={primary}
                disabled={!nav.enabled}
                data-survey-step-next={nav.action === "next" ? "" : undefined}
                onClick={nav.action === "next" ? (e) => { e.preventDefault(); setFocusIdx(nav.index + 1) } : undefined}
              >
                {nav.action === "next" ? "다음" : "보내기"}
              </Button>
            </>
          ) : (
            sendButton
          )}
        </div>
      </form>
    )
  }

  // 「처음부터 다시」 는 위 ⋯ 메뉴로 — 아래 시트에는 지금 답하는 일만 둔다
  const menu = talking ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="설문 메뉴"
        data-survey-menu
        className="touch-target flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} size={18} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem className="touch-target" disabled={busy} onClick={() => setConfirmReset(true)}>
          처음부터 다시
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  return (
    <section data-ai-survey={state.status === "NONE" ? "intro" : done ? "submitted" : state.status === "CONFIRM" ? "confirm" : "asking"} data-messenger className="relative flex min-h-0 flex-1 flex-col">
      <CoverageBars coverage={state.coverage} menu={menu} />

      <div ref={thread} onScroll={onThreadScroll} role="log" aria-label="설문 대화" data-survey-thread className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {/* 끝 여백 = 떠 있는 시트 높이 — 마지막 말이 시트 위에 멈추고, 그 위로는 대화가 시트 뒤로 비쳐 지나간다 */}
        <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 sm:px-6" style={{ paddingBottom: dockH + 20 }}>
          <OmnisSays data-survey-intro="">
            안녕하세요. AI 를 어떻게 쓰고 계신지 몇 가지 여쭤볼게요.
            <div className="mt-1.5 text-[15px] text-muted-foreground">
              얼마나 쓰는지 · 어떤 일에 쓰는지 · 옴니스가 해 주면 좋겠는 일, 세 가지예요. 숫자는 밀거나 눌러서 고르고, 나머지는 편하게 말해 주세요(추천 답을 눌러도 돼요). 2~3분이면 끝나고 중간에 나가도 이어서 할 수 있어요.
              {/* 「예산」 을 말하면 답을 부풀리거나 줄이기 쉽다 — 쓰임과 공개 범위만 말한다(작업지시자 2026-11-12) */}
              <span data-survey-purpose className="mt-1.5 block">옴니스가 어떤 일을 도와야 할지 정하는 데 씁니다. 개인 평가와 상관없고, 회사에는 전체 합계만 보입니다. 정확히 모르면 『잘 모르겠음』을 골라도 됩니다.</span>
            </div>
          </OmnisSays>

          {state.turns.map((t) => (
            <div key={t.id} className="contents">
              <OmnisSays fresh={t.id === freshId} {...(t === pending ? { "data-survey-question": "" } : {})}>{t.ask.question}</OmnisSays>
              {t.answer && <MyAnswer turn={t} active={t.id === editingId} hint={t === lastAnswered} onEdit={done || busy || t.dead ? undefined : () => startEdit(t)} />}
            </div>
          ))}

          {sent && (
            <div className={cn("mt-5 flex flex-col items-end", MESSAGE_ENTER)}>
              <div className="max-w-[85%] whitespace-pre-wrap break-keep rounded-[24px] rounded-br-lg bg-primary/10 px-[18px] py-[12px] text-[17px] leading-[1.6] opacity-60 [overflow-wrap:anywhere]">{sent}</div>
            </div>
          )}
          {asking && <OmnisSays fresh data-survey-waiting="">{incoming || <TypingDots />}</OmnisSays>}

          {closing && (
            <OmnisSays fresh={freshId !== null} data-survey-closing="">
              {done ? "제출했습니다. 고맙습니다." : "이렇게 이해했어요. 맞나요?"}
              {state.summary && <div data-survey-summary className="mt-3 rounded-2xl bg-muted/60 px-4 py-3 text-[15px] leading-relaxed">{state.summary}</div>}
              {!done && !checkDismissed && checkFlags.length > 0 && (
                // 앞뒤가 안 맞아 보이는 답 — 한 번만 묻는다. 고치지 않아도 제출할 수 있다
                <div data-survey-check className="mt-3 flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-[15px] leading-relaxed">
                  <span className="font-medium">이 부분 고칠까요?</span>
                  <ul className="flex flex-col gap-1.5">
                    {checkFlags.map((f) => (
                      <li key={f.code} data-survey-flag={f.code} className="flex flex-col gap-1.5">
                        <span className="break-keep">{FLAG_TEXT[f.code]}</span>
                        <span className="flex flex-wrap gap-1.5">
                          {f.turnIds.map((id) => {
                            const i = state.turns.findIndex((t) => t.id === id)
                            const t = state.turns[i]
                            if (!t?.answer || t.dead) return null
                            return (
                              <Button key={id} type="button" variant="outline" size="sm" className="touch-target h-9 rounded-full bg-background/70 px-3 text-[13.5px]" disabled={busy} onClick={() => startEdit(t)}>
                                {i + 1}번 답 고치기
                              </Button>
                            )
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <button type="button" data-survey-check-keep onClick={() => setCheckDismissed(true)} className="touch-hit self-start text-[13.5px] text-muted-foreground underline underline-offset-4">
                    이대로 둘게요
                  </button>
                </div>
              )}
              {state.metrics && (
                <div className="mt-3">
                  <SurveyMetrics metrics={state.metrics} turns={state.turns} />
                </div>
              )}
              {!done && <div className="mt-2 text-[14px] text-muted-foreground">고칠 답이 있으면 그 말풍선을 누르거나 아래에 말해 주세요.</div>}
              {done && (
                <div data-survey-redo-hint className="mt-2 text-[14px] text-muted-foreground">
                  달라진 것이 있으면 「다시 하기」 로 새로 답할 수 있어요. 이 응답은 기록으로 남고, 집계에는 가장 최근에 제출한 응답이 쓰입니다.
                  {(state.earlier ?? 0) > 0 && ` 앞서 제출한 응답 ${state.earlier}건도 기록으로 남아 있어요.`}
                </div>
              )}
            </OmnisSays>
          )}

          {note && !busy && <OmnisSays fresh data-survey-note="">{note}</OmnisSays>}
        </div>
      </div>

      {/* 떠 있는 하단 시트 — 채팅 입력창 · 하단 nav 와 같은 유리(.glass). 높이는 내용만큼, 화면의 40% 를 넘으면 시트 안에서 스크롤 */}
      {/* data-keyboard-dock — 이 안의 입력창에 포커스가 가면 채팅 입력창처럼 키보드 바로 위에 붙는다(hooks/use-keyboard-open.ts):
          셸이 보이는 높이로 줄고 하단 nav 와 홈 인디케이터 여백이 걷힌다. 표식이 없으면 셸이 그대로라 iOS 가 화면을 밀어 올리고,
          시트와 키보드 사이가 뜨며 하단 nav 가 키보드 위로 반쯤 남았다(2026-11-12 폰 스크린샷) */}
      <div data-survey-dock-wrap className="room-edge-bottom pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3 sm:px-6">
        <div ref={dockRef} data-survey-dock data-keyboard-dock className="glass pointer-events-auto mx-auto w-full max-w-[720px] rounded-[28px]">
          <div className="max-h-[calc(var(--app-vh)*0.4)] overflow-y-auto overscroll-contain p-3">{dock}</div>
        </div>
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{done ? "설문을 다시 할까요?" : "처음부터 다시 할까요?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {done ? "처음부터 새로 답합니다. 지금 제출한 응답은 기록으로 남고, 새로 제출하면 집계에는 새 응답이 쓰입니다." : "지금 답하던 내용이 지워집니다."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
            <AlertDialogAction className="touch-target" onClick={() => void reset()}>다시 하기</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
