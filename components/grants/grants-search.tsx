"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

/** 입력이 멈춘 뒤 주소를 바꾸기까지(ms) */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * 국가과제 검색 칸 — 주소의 ?q= 를 바꾼다(다른 칸 · 탭 · 보기는 그대로, 쪽 번호만 지운다).
 * 찾기는 서버가 한다(lib/grants-search.ts). 우리 결정 · 과제 후보 · 목록 · 보드 어디서든 같은 칸을 쓴다.
 * count 를 주면 칸 오른쪽에 결과 건수를 보인다.
 */
export function GrantsSearch({ count, className }: { count?: number | null; className?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const urlQ = params.get("q") ?? ""
  const [value, setValue] = useState(urlQ)
  const [pending, startTransition] = useTransition()
  const focused = useRef(false)

  // 뒤로 가기 · 칩 이동처럼 주소가 바뀌면 칸도 따라간다(입력 중에는 덮지 않는다)
  useEffect(() => {
    if (!focused.current) setValue(urlQ)
  }, [urlQ])

  useEffect(() => {
    const next = value.trim()
    if (next === urlQ.trim()) return
    const t = setTimeout(() => {
      const p = new URLSearchParams(params.toString())
      if (next) p.set("q", next)
      else p.delete("q")
      p.delete("page")
      const qs = p.toString()
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value, urlQ, params, pathname, router])

  return (
    <div className={cn("glass relative flex h-9 w-full items-center rounded-full focus-within:ring-2 focus-within:ring-ring/50 sm:max-w-sm", className)} data-grants-search>
      <HugeiconsIcon
        icon={Search01Icon}
        size={15}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute left-3 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => (focused.current = true)}
        onBlur={() => (focused.current = false)}
        onKeyDown={(e) => e.key === "Escape" && setValue("")}
        placeholder="검색"
        aria-label="국가과제 검색"
        aria-busy={pending || undefined}
        enterKeyHint="search"
        className="h-full min-w-0 flex-1 rounded-full border-0 bg-transparent pr-3 pl-8 text-[16px] shadow-none outline-none focus-visible:ring-0 sm:text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {count != null && (
        <span
          className={cn("shrink-0 pr-3.5 text-[12px] text-muted-foreground tabular-nums transition-opacity", pending && "opacity-40")}
          aria-live="polite"
          data-grants-search-count
        >
          {count}건
        </span>
      )}
    </div>
  )
}
