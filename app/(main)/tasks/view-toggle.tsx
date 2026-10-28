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
          className={[
            "touch-target inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] transition-colors",
            view === o.key
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <HugeiconsIcon icon={o.icon} size={12} aria-hidden />
          {o.label}
        </button>
      ))}
    </div>
  )
}
