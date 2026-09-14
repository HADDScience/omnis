"use client"

import {
  Children,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import Spreadsheet, { type CellBase, type Matrix } from "react-spreadsheet"
import { formatDistanceToNow } from "date-fns"
import { ko } from "date-fns/locale"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BubbleChatSparkIcon,
  BubbleChatQuestionIcon,
  ArrowUp01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons"
import type { EmbeddingSource } from "@/lib/embeddings"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"

import { apiUrl } from "@/lib/base-path"
/**
 * 서버가 쓰는 것과 **같은** 타입을 가져온다. 여기서 따로 선언해 두면 서버 쪽에
 * 값이 늘어났을 때 조용히 어긋나고, sourceHref 가 undefined 를 돌려주고,
 * 그 값이 <Link href> 로 들어가 페이지 전체가 흰 화면이 된다. 실제로 IP_CASE 가
 * 그렇게 됐다.
 */
type SourceType = EmbeddingSource

interface Source {
  id: string
  source: SourceType
  sourceId: string
  title: string
  sourceLabel: string
  similarity: number
}

interface QA {
  id: string
  question: string
  answer: string
  sources: Source[]
  createdAt?: string
}

const EXAMPLES = [
  "회사 매출과 재무 현황 알려줘",
  "보유한 인증과 특허가 뭐가 있어?",
  "진행 중인 업무를 요약해줘",
]

const IP_PLATFORM_URL = "https://haddscience.github.io/ip-platform/"

/**
 * 출처를 열 주소. 열 곳이 없으면 null 을 준다.
 *
 * default 분기가 핵심이다. EmbeddingSource 에 값이 늘어나도 여기서 null 로 떨어질 뿐,
 * undefined 가 <Link href> 에 들어가 화면 전체를 날리지는 않는다.
 */
function sourceHref(s: Source): string | null {
  switch (s.source) {
    case "OMNIS_CARD":
      return `/omnis/${s.sourceId}`
    case "TASK":
      return `/tasks/${s.sourceId}`
    case "WEEKLY_REPORT":
      return `/reports/${s.sourceId}`
    case "CHAT_MESSAGE":
      return "/chat"
    case "IP_CASE":
      // 지식재산권은 아직 옴니스 안에 상세 화면이 없다. 외부 플랫폼으로 보낸다.
      return IP_PLATFORM_URL
    default:
      // 위 case 가 하나라도 빠지면 여기서 컴파일이 깨진다 — 흰 화면 대신
      // 빌드가 먼저 막힌다. 런타임에 모르는 값이 와도 null 이라 안전하다.
      s.source satisfies never
      return null
  }
}

function relativeTime(iso?: string): string {
  if (!iso) return ""
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ko })
  } catch {
    return ""
  }
}

// ─── 답변 마크다운 렌더링 ────────────────────────────────

interface HNode {
  type: string
  value?: string
  tagName?: string
  children?: HNode[]
}

/** hast 노드의 텍스트를 재귀로 이어붙인다 */
function hastText(node: HNode): string {
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(hastText).join("")
}

/** 마크다운 표(hast table 노드)를 헤더·행 배열로 변환 */
function parseHastTable(node: HNode): { headers: string[]; rows: string[][] } {
  const headers: string[] = []
  const rows: string[][] = []
  for (const sec of node.children ?? []) {
    if (sec.type !== "element") continue
    const trs = (sec.children ?? []).filter(
      (n) => n.type === "element" && n.tagName === "tr"
    )
    for (const tr of trs) {
      const cells = (tr.children ?? []).filter(
        (c) => c.type === "element" && (c.tagName === "td" || c.tagName === "th")
      )
      if (sec.tagName === "thead") {
        cells.forEach((c) => headers.push(hastText(c).trim()))
      } else {
        rows.push(cells.map((c) => hastText(c).trim()))
      }
    }
  }
  return { headers, rows }
}

/** 각주 배지 — 출처가 있으면 호버 미리보기 + 클릭 이동, 없으면 단순 배지 */
function Citation({ num, source }: { num: string; source?: Source }) {
  const router = useRouter()
  const href = source ? sourceHref(source) : null
  if (!source) {
    return <span className="omnis-citation">{num}</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={
          href ? "omnis-citation omnis-citation--link" : "omnis-citation"
        }
        onClick={href ? () => router.push(href) : undefined}
      >
        {num}
      </TooltipTrigger>
      <TooltipContent>
        {source.sourceLabel} · {source.title}
      </TooltipContent>
    </Tooltip>
  )
}

/** 마크다운 표는 react-spreadsheet 읽기 전용 그리드로 렌더 */
const tableComponent: Components["table"] = ({ node, children }) => {
  const parsed = node ? parseHastTable(node as unknown as HNode) : null
  if (!parsed || (parsed.headers.length === 0 && parsed.rows.length === 0)) {
    return <table>{children}</table>
  }
  const data: Matrix<CellBase> = parsed.rows.map((row) =>
    row.map((cell) => ({ value: cell, readOnly: true }))
  )
  return (
    <div className="omnis-spreadsheet omnis-spreadsheet--readonly my-2 overflow-x-auto">
      <Spreadsheet data={data} columnLabels={parsed.headers} hideRowIndicators />
    </div>
  )
}

/**
 * 모델은 줄바꿈 한 번으로 줄을 나눠 쓴다(「**관리번호:** …⏎**현재 단계:** …」). 마크다운은 이것을 한 문단으로
 * 붙여 버리므로 줄 끝에 hard break(공백 두 칸)를 넣는다. 목록 · 표 · 제목 · 인용 · 코드 블록 줄은 건드리지 않는다.
 * 줄 바로 아래가 `---` 면 그 줄이 제목(setext)으로 바뀌므로 빈 줄을 끼운다.
 */
function keepLineBreaks(md: string): string {
  const lines = md.split("\n")
  const BLOCK = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|\||>|```)/
  const RULE = /^\s*(-{3,}|\*{3,}|_{3,}|={3,})\s*$/
  let inCode = false
  return lines
    .map((line, i) => {
      if (/^\s*```/.test(line)) {
        inCode = !inCode
        return line
      }
      const next = lines[i + 1]
      if (inCode || next === undefined || !line.trim() || !next.trim()) return line
      if (RULE.test(next)) return RULE.test(line) ? line : `${line}\n`
      if (BLOCK.test(next) || /^\s*(\||#{1,6}\s)/.test(line) || RULE.test(line)) return line
      return `${line}  `
    })
    .join("\n")
}

/** 각주 토큰 — [1] · [1, 2] · [7-9]. 모델이 여러 번호를 한 괄호에 묶어 쓴다 */
const CITE_TOKEN = /(\[\d+(?:\s*[,，~–-]\s*\d+)*\])/
/** 출원·등록·사건번호처럼 하이픈으로 이은 번호 (10-2766706, 10-2021-0119577) */
const ID_NUMBER = /(\b\d{2,}(?:-\d{2,})+\b)/

/** "[1, 3-5]" → [1, 3, 4, 5]. 범위가 20을 넘으면 연도 같은 것으로 보고 펼치지 않는다 */
function citeNumbers(token: string): number[] {
  const nums: number[] = []
  for (const part of token.slice(1, -1).split(/\s*[,，]\s*/)) {
    const range = /^(\d+)\s*[~–-]\s*(\d+)$/.exec(part)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      if (b < a || b - a > 20) return []
      for (let n = a; n <= b; n++) nums.push(n)
    } else if (/^\d+$/.test(part)) nums.push(Number(part))
  }
  return nums
}

/** qa.sources를 클로저로 잡아 각주를 출처와 연결한 마크다운 컴포넌트 생성 */
function buildMarkdownComponents(sources: Source[]): Components {
  // 출처 번호 범위를 벗어난 괄호([2024-2025] 같은 것)는 각주로 보지 않는다
  const maxCite = sources.length || 30

  const decorateText = (text: string, keyBase: number): ReactNode => {
    if (!text.includes("[") && !/\d-\d/.test(text)) return text
    const out: ReactNode[] = []
    text.split(CITE_TOKEN).forEach((seg, i) => {
      if (i % 2 === 1) {
        const nums = citeNumbers(seg)
        if (nums.length > 0 && nums.every((n) => n >= 1 && n <= maxCite)) {
          nums.forEach((n, j) =>
            out.push(<Citation key={`${keyBase}-${i}-${j}`} num={String(n)} source={sources[n - 1]} />)
          )
          return
        }
      }
      seg.split(ID_NUMBER).forEach((s, k) => {
        if (!s) return
        out.push(
          k % 2 === 1 ? (
            <span key={`${keyBase}-${i}-n${k}`} className="omnis-nowrap">
              {s}
            </span>
          ) : (
            s
          )
        )
      })
    })
    return out
  }

  const decorate = (children: ReactNode): ReactNode =>
    Children.map(children, (child, idx) => (typeof child === "string" ? decorateText(child, idx) : child))

  return {
    p: ({ children }) => <p>{decorate(children)}</p>,
    li: ({ children }) => <li>{decorate(children)}</li>,
    strong: ({ children }) => <strong>{decorate(children)}</strong>,
    em: ({ children }) => <em>{decorate(children)}</em>,
    h1: ({ children }) => <h3>{decorate(children)}</h3>,
    h2: ({ children }) => <h3>{decorate(children)}</h3>,
    h3: ({ children }) => <h3>{decorate(children)}</h3>,
    h4: ({ children }) => <h4>{decorate(children)}</h4>,
    td: ({ children }) => <td>{decorate(children)}</td>,
    th: ({ children }) => <th>{decorate(children)}</th>,
    table: tableComponent,
  }
}

export function OmnisAsk({ variant = "page" }: { variant?: "page" | "dock" }) {
  const dock = variant === "dock"
  const [question, setQuestion] = useState("")
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [history, setHistory] = useState<QA[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 저장된 질문 내역 불러오기
  useEffect(() => {
    let cancelled = false
    fetch(apiUrl("/api/omnis/ask"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setHistory(data as QA[])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim()
    if (q.length < 2) {
      toast.error("질문을 2자 이상 입력해 주세요")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(apiUrl("/api/omnis/ask"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "답변 생성에 실패했습니다")

      setHistory((prev) => [data as QA, ...prev])
      setQuestion("")
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setLoading(false)
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!loading) ask(question)
    }
  }

  return (
    <div
      className={
        dock
          ? "min-h-0 flex-1 overflow-auto"
          : "h-full overflow-auto"
      }
    >
      <div
        className={
          dock
            ? "px-3 py-3"
            : "mx-auto w-full max-w-[760px] px-6 pb-20 pt-10 sm:px-8"
        }
      >
        {/* 헤더 (페이지 변형만) */}
        {!dock && (
          <div className="mb-6">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <HugeiconsIcon icon={BubbleChatSparkIcon} size={18} />
              </div>
              <h1 className="text-[20px] font-bold tracking-[-0.02em]">
                옴니스에게 질문
              </h1>
            </div>
            <p className="mt-1.5 text-[13px] text-muted-foreground">
              자연어로 물어보면 옴니스 카드·업무·주간보고·채팅을 모두 검색해
              답해 드려요.
            </p>
          </div>
        )}

        {/* 질문 입력 */}
        <div className="rounded-xl border bg-card shadow-[0_4px_12px_rgba(0,0,0,0.04)] focus-within:border-border-strong">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            disabled={loading}
            aria-label="옴니스에게 보낼 질문"
            placeholder="예: 작년 매출이 얼마였어?"
            className="block w-full resize-none bg-transparent px-4 pt-3.5 text-[14px] outline-none placeholder:text-muted-foreground disabled:opacity-60"
          />
          <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-1">
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Enter로 질문 · Shift+Enter 줄바꿈
            </span>
            <Button
              size="lg"
              onClick={() => ask(question)}
              disabled={loading || question.trim().length < 2}
              className="ml-auto gap-1.5 ai-rainbow-border"
            >
              {loading ? (
                <Spinner />
              ) : (
                <HugeiconsIcon icon={ArrowUp01Icon} size={15} />
              )}
              질문하기
            </Button>
          </div>
        </div>

        {/* 답변 생성 중 — 스켈레톤 */}
        {loading && (
          <div className="mt-7">
            <SkeletonAnswer caption="옴니스가 사내 지식에서 답을 찾는 중..." />
          </div>
        )}

        {/* 질문 내역 로딩 중 — 스켈레톤 */}
        {initializing && (
          <div className="mt-7 flex flex-col gap-7">
            <SkeletonAnswer />
            <SkeletonAnswer />
          </div>
        )}

        {/* 빈 상태 — 예시 질문 */}
        {!initializing && history.length === 0 && !loading && (
          <div className="mt-8">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              이렇게 물어보세요
            </div>
            <div className="flex flex-col gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => {
                    setQuestion(ex)
                    ask(ex)
                  }}
                  className="flex items-center gap-2.5 rounded-lg border bg-card px-4 py-3 text-left text-[13px] transition-colors hover:border-border-strong hover:bg-muted/40"
                >
                  <HugeiconsIcon
                    icon={BubbleChatQuestionIcon}
                    size={15}
                    className="shrink-0 text-muted-foreground"
                  />
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 답변 내역 (최신순) */}
        {history.length > 0 && (
          <div className="mt-7 flex flex-col gap-7">
            {history.map((qa) => (
              <AnswerBlock key={qa.id} qa={qa} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** 데이터 로딩 중 표시되는 스켈레톤. caption이 있으면 답변 생성 중, 없으면 내역 로딩. */
function SkeletonAnswer({ caption }: { caption?: string }) {
  return (
    <div>
      {caption ? (
        <div className="mb-2.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Spinner />
          {caption}
        </div>
      ) : (
        <div className="mb-2.5 flex items-start gap-2">
          <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
          <Skeleton className="h-5 w-2/5" />
        </div>
      )}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-3.5 w-[88%]" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-[70%]" />
          <Skeleton className="h-3.5 w-[92%]" />
        </div>
      </div>
    </div>
  )
}

function AnswerBlock({ qa }: { qa: QA }) {
  const time = relativeTime(qa.createdAt)
  const components = useMemo(
    () => buildMarkdownComponents(qa.sources),
    [qa.sources]
  )
  return (
    <div>
      {/* 질문 */}
      <div className="mb-2.5 flex items-start gap-2">
        <HugeiconsIcon
          icon={BubbleChatQuestionIcon}
          size={16}
          className="mt-0.5 shrink-0 text-primary"
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-snug">
            {qa.question}
          </h2>
          {time && (
            <span className="text-[11px] text-muted-foreground">{time}</span>
          )}
        </div>
      </div>

      {/* 답변 + 출처 */}
      <div className="rounded-xl border bg-card p-4">
        <TooltipProvider delay={150}>
          <div className="omnis-md">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
              {keepLineBreaks(qa.answer)}
            </ReactMarkdown>
          </div>
        </TooltipProvider>

        {/* 참고 자료 — 하단에 접힌 상태로 제공 */}
        {qa.sources.length > 0 && (
          <details className="group mt-3 border-t pt-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                className="-rotate-90 transition-transform group-open:rotate-0"
              />
              참고한 자료 {qa.sources.length}건
            </summary>
            <div className="mt-2 flex flex-col gap-1.5">
              {qa.sources.map((s, i) => (
                <SourceRow key={s.id} index={i} source={s} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

/** 출처 한 줄. 열 곳이 없으면 링크가 아니라 그냥 줄로 그린다. */
function SourceRow({ index, source }: { index: number; source: Source }) {
  const href = sourceHref(source)
  const external = href?.startsWith("http") ?? false
  const body = (
    <>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-[9px] font-semibold text-primary">
        {index + 1}
      </span>
      <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {source.sourceLabel}
      </span>
      <span className="flex-1 truncate font-medium">{source.title}</span>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {source.similarity}%
      </span>
    </>
  )
  const base =
    "flex items-center gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5 text-[12px]"

  if (!href) {
    return <div className={base}>{body}</div>
  }
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={`${base} transition-colors hover:border-border-strong hover:bg-muted`}
    >
      {body}
    </Link>
  )
}
