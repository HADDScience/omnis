"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Calendar03Icon,
  Cancel01Icon,
  CancelCircleIcon,
  Search01Icon,
  UserSearch01Icon,
} from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"

interface Page {
  results: { id: string }[]
  hasMore: boolean
  nextBefore: string | null
  total: number | null
}

interface ChatSearchProps {
  roomId: string
  /** 업무 스레드만 보는 중이면 그 업무 안에서만 찾는다 */
  taskId: string | null
  users: { id: string; name: string }[]
  onClose: () => void
  /** 이 결과 자리로 가서 강조한다 */
  onGo: (messageId: string) => void
  /** 이 시각 이후 첫 메시지 자리로 */
  onGoDate: (atIso: string) => void
  /** 말풍선 안 표시에 쓸 검색어 — 결과가 돌아온 검색어만 넘긴다 */
  onSearchTextChange: (text: string) => void
}

const MIN_QUERY = 2

/**
 * 채팅 검색 줄 — 카톡 PC 검색처럼 (2026-10-06, mydocs/plans/archives/2026-10-06-chat-search-inline.md).
 *
 * 대화를 덮지 않고 패널 위에 붙는다. 검색하면 가장 최근 결과로 바로 가고,
 * ▲ 는 더 옛 결과 · ▼ 는 더 최근 결과. 결과 id 는 20건씩 필요할 때 더 받는다.
 */
export function ChatSearch({ roomId, taskId, users, onClose, onGo, onGoDate, onSearchTextChange }: ChatSearchProps) {
  const [query, setQuery] = useState("")
  const [author, setAuthor] = useState<{ id: string; name: string } | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [nextBefore, setNextBefore] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const [authorOpen, setAuthorOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // 부모 콜백이 렌더마다 새로 만들어져도 검색을 다시 돌리지 않게
  const callbacks = useRef({ onGo, onSearchTextChange })
  useEffect(() => {
    callbacks.current = { onGo, onSearchTextChange }
  })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim()
  const active = q.length >= MIN_QUERY || !!author

  async function fetchPage(before: string | null, signal?: AbortSignal): Promise<Page> {
    const params = new URLSearchParams({ roomId })
    if (q.length >= MIN_QUERY) params.set("q", q)
    if (author) params.set("authorId", author.id)
    if (taskId) params.set("taskId", taskId)
    if (before) params.set("before", before)
    const res = await fetch(apiUrl(`/api/chat/search?${params.toString()}`), { signal })
    if (!res.ok) throw new Error(`search ${res.status}`)
    return res.json()
  }

  useEffect(() => {
    if (!active) {
      setIds([])
      setTotal(0)
      setNextBefore(null)
      setSearched(false)
      setLoading(false)
      callbacks.current.onSearchTextChange("")
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchPage(null, controller.signal)
        .then((page) => {
          const found = page.results.map((r) => r.id)
          setIds(found)
          setTotal(page.total ?? found.length)
          setNextBefore(page.nextBefore)
          setIndex(0)
          setSearched(true)
          callbacks.current.onSearchTextChange(q.length >= MIN_QUERY ? q : "")
          if (found[0]) callbacks.current.onGo(found[0])
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
    // fetchPage 는 q · author · roomId · taskId 만 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, author, roomId, taskId])

  const canOlder = index + 1 < ids.length || !!nextBefore
  const canNewer = index > 0

  async function older() {
    if (loading || !canOlder) return
    if (index + 1 < ids.length) {
      setIndex(index + 1)
      onGo(ids[index + 1])
      return
    }
    setLoading(true)
    try {
      const page = await fetchPage(nextBefore)
      const fresh = page.results.map((r) => r.id).filter((id) => !ids.includes(id))
      setNextBefore(page.nextBefore)
      if (fresh.length === 0) return
      setIds([...ids, ...fresh])
      setIndex(index + 1)
      onGo(fresh[0])
    } catch {
      toast.error("더 불러오지 못했습니다")
    } finally {
      setLoading(false)
    }
  }

  function newer() {
    if (!canNewer) return
    setIndex(index - 1)
    onGo(ids[index - 1])
  }

  const iconButton =
    "touch-target inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"

  return (
    <div
      role="search"
      aria-label="채팅 검색"
      className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 border-b px-2 py-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {/* 입력칸 — 좁으면 아래 아이콘 묶음이 다음 줄로 접힌다 */}
      <div className="flex h-9 min-w-0 flex-[1_1_170px] items-center gap-1.5 rounded-lg border border-primary/50 bg-background px-2 ring-2 ring-primary/15 focus-within:border-primary">
        <HugeiconsIcon icon={Search01Icon} size={15} className="shrink-0 text-muted-foreground" aria-hidden />
        {author && (
          <span className="inline-flex max-w-[45%] shrink-0 items-center gap-0.5 rounded bg-primary/10 py-0.5 pl-1.5 pr-0.5 text-[11px] font-medium text-primary">
            <span className="truncate">{author.name}</span>
            <button
              type="button"
              onClick={() => setAuthor(null)}
              aria-label={`${author.name} 거르기 풀기`}
              className="relative rounded p-0.5 after:absolute after:-inset-[13px] hover:bg-primary/15"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} aria-hidden />
            </button>
          </span>
        )}
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (e.shiftKey) newer()
            else void older()
          }}
          placeholder={author ? "검색어 (비우면 이 사람 글 전체)" : taskId ? "이 업무 대화에서 찾기" : "대화 내용 검색"}
          aria-label="채팅 검색어"
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? (
          <Spinner className="h-4 w-4 shrink-0" />
        ) : (
          active &&
          searched && (
            <span aria-live="polite" className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {total > 0 ? `${index + 1}/${total}` : "결과 없음"}
            </span>
          )
        )}
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("")
              inputRef.current?.focus()
            }}
            aria-label="검색어 지우기"
            // 아이콘은 16px 이지만 누르는 자리는 44px — 입력칸 높이를 늘리지 않으려고 가상 요소로 넓힌다
            className="relative shrink-0 rounded-full text-muted-foreground after:absolute after:-inset-[14px] hover:text-foreground"
          >
            <HugeiconsIcon icon={CancelCircleIcon} size={16} aria-hidden />
          </button>
        )}
      </div>

      {/* 아주 좁으면(200px) 이 묶음도 한 번 더 접힌다 */}
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end">
        <button type="button" onClick={() => void older()} disabled={!canOlder} aria-label="이전 결과" title="이전 결과 (Enter)" className={iconButton}>
          <HugeiconsIcon icon={ArrowUp01Icon} size={17} aria-hidden />
        </button>
        <button type="button" onClick={newer} disabled={!canNewer} aria-label="다음 결과" title="다음 결과 (Shift+Enter)" className={iconButton}>
          <HugeiconsIcon icon={ArrowDown01Icon} size={17} aria-hidden />
        </button>

        <Popover open={dateOpen} onOpenChange={setDateOpen}>
          <PopoverTrigger render={<button type="button" aria-label="날짜로 이동" title="날짜로 이동" className={iconButton} />}>
            <HugeiconsIcon icon={Calendar03Icon} size={16} aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={ko}
              disabled={{ after: new Date() }}
              onSelect={(date) => {
                if (!date) return
                setDateOpen(false)
                // 날짜는 한국 시각 자정부터 — 서버는 그 시각 이후 첫 글을 고른다
                onGoDate(`${format(date, "yyyy-MM-dd")}T00:00:00+09:00`)
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover open={authorOpen} onOpenChange={setAuthorOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label="보낸 사람으로 찾기"
                title="보낸 사람으로 찾기"
                aria-pressed={!!author}
                className={cn(iconButton, author && "bg-primary/10 text-primary")}
              />
            }
          >
            <HugeiconsIcon icon={UserSearch01Icon} size={16} aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-48 p-1">
            <ul aria-label="보낸 사람" className="max-h-64 overflow-y-auto">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthor(u)
                      setAuthorOpen(false)
                      inputRef.current?.focus()
                    }}
                    className={cn(
                      "touch-target flex w-full items-center rounded px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                      author?.id === u.id && "bg-primary/10 font-medium text-primary",
                    )}
                  >
                    {u.name}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        <button type="button" onClick={onClose} aria-label="검색 닫기" title="검색 닫기 (Esc)" className={iconButton}>
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}
