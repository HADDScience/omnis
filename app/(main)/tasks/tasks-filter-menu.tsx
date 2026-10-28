"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, FilterIcon } from "@hugeicons/core-free-icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** 사이드바 「빠른 필터」 가 있던 자리. 사이드바를 걷으면서(2026-10-28) 업무 툴바로 왔다 */
const QUICK_FILTERS = [
  { key: "due-today", label: "오늘 마감" },
  { key: "i-assigned", label: "내가 지시한 업무" },
  { key: "i-own", label: "내가 담당" },
] as const

export function TasksFilterMenu({ active }: { active: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="touch-target inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted"
          >
            <HugeiconsIcon icon={FilterIcon} size={11} aria-hidden />
            필터
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} aria-hidden />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-[180px]">
        <DropdownMenuItem render={<Link href="/tasks" />} className={active ? "" : "font-semibold"}>
          전체
        </DropdownMenuItem>
        {QUICK_FILTERS.map((f) => (
          <DropdownMenuItem
            key={f.key}
            render={<Link href={`/tasks?filter=${f.key}`} />}
            className={active === f.key ? "font-semibold" : ""}
          >
            {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
