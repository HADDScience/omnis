"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Search01Icon,
  BookOpen01Icon,
  Task01Icon,
  FileAttachmentIcon,
  AiMagicIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Kbd } from "@/components/ui/kbd"
import { useCommandPalette } from "./command-palette-context"

interface CardHit {
  id: string
  title: string
  category: string
  author: string
  version: number
  updatedAt: string
}
interface TaskHit {
  id: string
  slug: string
  title: string
  owner: string
  status: string
  deadline: string | null
}
interface ReportHit {
  id: string
  title: string
  weekStart: string
}

interface SearchResult {
  cards: CardHit[]
  tasks: TaskHit[]
  reports: ReportHit[]
  elapsedMs: number
}

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult>({
    cards: [],
    tasks: [],
    reports: [],
    elapsedMs: 0,
  })
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!isOpen) {
      setQuery("")
      return
    }
  }, [isOpen])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResults({ cards: [], tasks: [], reports: [], elapsedMs: 0 })
      return
    }
    setLoading(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: SearchResult) => setResults(data))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 180)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const total = results.cards.length + results.tasks.length + results.reports.length

  function go(href: string) {
    close()
    router.push(href)
  }

  return (
    <CommandDialog
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) close()
      }}
      title="HADD DB 검색"
      description="HADD 카드, 업무, 보고서를 검색합니다"
      className="w-[640px] max-w-[calc(100vw-32px)] sm:!max-w-[640px] p-0"
      shouldFilter={false}
    >
      <div className="relative">
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="HADD, 업무, 사람, AI 명령어..."
          className="h-12 pr-14 text-[15px]"
        />
        <Kbd className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 bg-muted/60 text-[10px]">
          esc
        </Kbd>
      </div>
      <CommandList className="max-h-[420px]">
        {total === 0 && !loading && query && (
          <CommandEmpty>결과 없음</CommandEmpty>
        )}

        {results.cards.length > 0 && (
          <CommandGroup heading="HADD DB · 카드">
            {results.cards.map((c, i) => (
              <CommandItem
                key={c.id}
                value={`card-${c.id}`}
                onSelect={() => go(`/omnis/${c.id}`)}
                className="gap-3"
              >
                <HugeiconsIcon icon={BookOpen01Icon} size={15} className="text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className={i === 0 ? "truncate text-[13px] font-semibold" : "truncate text-[13px] font-medium"}>
                    {c.title}
                  </div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {c.category} · v{c.version} {c.author && `· ${c.author}`}
                  </div>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">v{c.version}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.tasks.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="업무">
              {results.tasks.map((t) => {
                const overdue = t.deadline ? new Date(t.deadline) < new Date() && t.status !== "DONE" : false
                return (
                  <CommandItem
                    key={t.id}
                    value={`task-${t.id}`}
                    onSelect={() => go(`/tasks/${t.id}`)}
                    className="gap-3"
                  >
                    <HugeiconsIcon
                      icon={Task01Icon}
                      size={15}
                      className={overdue ? "text-destructive" : "text-muted-foreground"}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{t.title}</div>
                      <div className="truncate text-[11.5px] text-muted-foreground">
                        {t.owner} · {t.status}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">#{t.slug}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        {results.reports.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="주간 보고서">
              {results.reports.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`report-${r.id}`}
                  onSelect={() => go(`/reports/${r.id}`)}
                  className="gap-3"
                >
                  <HugeiconsIcon
                    icon={FileAttachmentIcon}
                    size={15}
                    className="text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{r.title}</div>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="작업">
          <CommandItem onSelect={() => go("/omnis?create=1")} className="gap-3">
            <HugeiconsIcon icon={PlusSignIcon} size={15} className="text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">새 HADD 카드 만들기</div>
              <div className="text-[11.5px] text-muted-foreground">카테고리 선택 후 편집</div>
            </div>
          </CommandItem>
          <CommandItem onSelect={() => go("/tasks?new=1")} className="gap-3">
            <HugeiconsIcon icon={PlusSignIcon} size={15} className="text-primary" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">새 업무 생성</div>
              <div className="text-[11.5px] text-muted-foreground">Dock의 /업무 슬래시 커맨드로도 가능</div>
            </div>
          </CommandItem>
        </CommandGroup>
      </CommandList>

      <div className="flex items-center gap-4 border-t bg-muted px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>이동
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>열기
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd>닫기
        </span>
        <div className="flex-1" />
        <span>
          {loading ? "검색 중..." : `${total} 결과 · ${results.elapsedMs}ms`}
        </span>
      </div>
    </CommandDialog>
  )
}
