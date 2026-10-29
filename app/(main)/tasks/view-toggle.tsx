"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { MenuSquareIcon, DashboardBrowsingIcon, HierarchyIcon } from "@hugeicons/core-free-icons"

export type TasksView = "list" | "board" | "graph"

interface ViewToggleProps {
  view: TasksView
  onChange: (v: TasksView) => void
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex shrink-0 items-center rounded-md border bg-card p-0.5">
      {(
        [
          { key: "list", label: "목록", icon: MenuSquareIcon },
          { key: "board", label: "보드", icon: DashboardBrowsingIcon },
          { key: "graph", label: "관계도", icon: HierarchyIcon },
        ] as const
      ).map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={view === o.key}
          aria-label={o.label}
          // 폰에서는 글자를 숨기고 아이콘만 둔다 — 셋이 글자까지 달면 툴바가 두 줄로 꺾였다.
          // 누르는 자리는 가로 44px 를 실제 폭으로, 세로는 touch-hit 막으로 채운다(묶음 테두리가 44px 로 부풀지 않게)
          className={[
            "touch-hit inline-flex items-center justify-center gap-1.5 rounded px-2 py-1 text-[11.5px] transition-colors [@media(pointer:coarse)]:min-w-[44px]",
            view === o.key
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <HugeiconsIcon icon={o.icon} size={12} aria-hidden />
          <span className="sr-only sm:not-sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
