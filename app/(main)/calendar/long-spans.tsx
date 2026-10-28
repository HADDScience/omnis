"use client"

import Link from "next/link"
import { useState } from "react"
import { spanLabel } from "@/lib/calendar/grid"
import type { CalendarItem } from "@/lib/calendar/types"
import { toneOf } from "./tones"

const COLLAPSED = 4

/**
 * 일주일이 넘는 기간(지원사업 · 프로젝트)은 칸마다 그리지 않고 여기 모은다.
 * 2026-10 로컬 스냅샷에서 지원사업 16건이 달 전체에 걸쳐 있었다 — 칸마다 그리면 모든 날이 같은 칩으로 찬다.
 */
export function LongSpans({ items, calendarOrder }: { items: CalendarItem[]; calendarOrder: string[] }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, COLLAPSED)
  return (
    <section aria-label="이 달에 걸친 기간" className="mb-3 rounded-lg border bg-card px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        이 달에 걸친 기간 · {items.length}
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((i) => {
          const tone = toneOf(i, calendarOrder)
          const inner = (
            <>
              <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
              <span className="shrink-0 text-[11.5px] text-muted-foreground">{i.tag}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">{i.title}</span>
              <span className="hidden shrink-0 text-[11.5px] text-muted-foreground tabular-nums sm:inline">{spanLabel(i)}</span>
            </>
          )
          return (
            <li key={i.id} className="min-w-0">
              {i.href ? (
                <Link href={i.href} className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-muted" title={spanLabel(i)}>
                  {inner}
                </Link>
              ) : (
                <div className="flex min-w-0 items-center gap-2 px-1 py-0.5" title={spanLabel(i)}>
                  {inner}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {items.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="touch-target mt-1 rounded px-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          {open ? "접기" : `${items.length - COLLAPSED}건 더 보기`}
        </button>
      )}
    </section>
  )
}
