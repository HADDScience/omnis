"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

interface Result {
  id: string
  createdAt: string
  author: { id: string; name: string }
  task: { id: string; name: string; slug: string } | null
  snippet: string
}

interface Page {
  results: Result[]
  hasMore: boolean
  nextBefore: string | null
}

interface ChatSearchProps {
  roomId: string
  /** 업무 스레드만 보는 중이면 그 업무 안에서만 찾는다 */
  taskId: string | null
  onClose: () => void
  /** 결과를 고르면 패널이 그 자리로 간다 */
  onPick: (messageId: string) => void
}

const MIN_QUERY = 2

/**
 * 채팅 패널 안 검색 (2026-10-06, mydocs/plans/archives/2026-10-06-chat-search.md).
 *
 * 목록 · 입력창 자리를 통째로 덮는다 — 380px 패널에 결과와 대화를 나란히 둘 폭이 없다.
 * 고르면 닫히고 패널이 그 글 앞뒤를 불러와 강조한다.
 */
export function ChatSearch({ roomId, taskId, onClose, onPick }: ChatSearchProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [searched, setSearched] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setResults([])
      setNextBefore(null)
      setSearched("")
      setLoading(false)
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchPage(q, null, controller.signal)
        .then((page) => {
          setResults(page.results)
          setNextBefore(page.nextBefore)
          setSearched(q)
        })
        .catch((err: unknown) => {
          if ((err as Error)?.name !== "AbortError") toast.error("검색하지 못했습니다")
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 300)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
    // fetchPage 는 roomId · taskId 만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, roomId, taskId])

  async function fetchPage(q: string, before: string | null, signal?: AbortSignal): Promise<Page> {
    const params = new URLSearchParams({ roomId, q })
    if (taskId) params.set("taskId", taskId)
    if (before) params.set("before", before)
    const res = await fetch(apiUrl(`/api/chat/search?${params.toString()}`), { signal })
    if (!res.ok) throw new Error(`search ${res.status}`)
    return res.json()
  }

  async function loadMore() {
    if (!nextBefore || loadingMore || !searched) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(searched, nextBefore)
      setResults((prev) => {
        const ids = new Set(prev.map((r) => r.id))
        return [...prev, ...page.results.filter((r) => !ids.has(r.id))]
      })
      setNextBefore(page.nextBefore)
    } catch {
      toast.error("더 불러오지 못했습니다")
    } finally {
      setLoadingMore(false)
    }
  }

  const q = query.trim()

  return (
    <div
      role="dialog"
      aria-label="채팅 검색"
      className="absolute inset-0 z-10 flex flex-col bg-background"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <HugeiconsIcon icon={Search01Icon} size={15} className="ml-1 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={taskId ? "이 업무 대화에서 찾기" : "채팅에서 찾기"}
          aria-label="채팅 검색어"
          className="h-9 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {loading && <Spinner className="h-4 w-4 shrink-0" />}
        <button
          type="button"
          onClick={onClose}
          aria-label="검색 닫기"
          title="검색 닫기 (Esc)"
          className="touch-target inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={15} aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.length < MIN_QUERY ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">두 글자 이상 입력하세요</p>
        ) : !loading && searched === q && results.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground">
            「{q}」 가 들어간 메시지가 없습니다
          </p>
        ) : (
          <ul aria-label="검색 결과" className="divide-y">
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick(r.id)}
                  className="touch-target flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="shrink-0 font-medium text-foreground/80">{r.author.name}</span>
                    <span className="shrink-0 tabular-nums">{format(new Date(r.createdAt), "yyyy.MM.dd HH:mm")}</span>
                    {r.task && (
                      <span className="min-w-0 truncate rounded bg-muted px-1">
                        <span className="opacity-60">#</span>
                        {r.task.name}
                      </span>
                    )}
                  </span>
                  <span className="break-keep text-[12.5px] leading-snug [overflow-wrap:anywhere]">
                    <Highlighted text={r.snippet} query={searched} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {nextBefore && results.length > 0 && (
          <div className="flex justify-center py-2">
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="touch-target inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              {loadingMore && <Spinner className="h-3.5 w-3.5" />}더 보기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 걸린 글자를 굵게 — 대소문자를 가리지 않고 모두 */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let at = lower.indexOf(needle)
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-200/70 px-0.5 font-semibold text-foreground dark:bg-amber-400/25">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
    at = lower.indexOf(needle, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}
