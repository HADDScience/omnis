"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { MenuSquareIcon, DashboardBrowsingIcon } from "@hugeicons/core-free-icons"

interface ViewToggleProps {
  view: "list" | "board"
  onChange: (v: "list" | "board") => void
}

export function ViewToggle({ view, onChange }: ViewToggleProps) {
  return (
    <div className="inline-flex items-center rounded-md border bg-card p-0.5">
      {(
        [
          { key: "list", label: "리스트", icon: MenuSquareIcon },
          { key: "board", label: "보드", icon: DashboardBrowsingIcon },
        ] as const
      ).map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={[
            "inline-flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] transition-colors",
            view === o.key
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          <HugeiconsIcon icon={o.icon} size={12} />
          {o.label}
        </button>
      ))}
    </div>
  )
}
