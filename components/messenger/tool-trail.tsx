"use client"

import { useId, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, CheckmarkCircle02Icon, Alert02Icon, Clock01Icon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { TOOL_LABEL } from "@/lib/agent/client-stream"
import { cn } from "@/lib/utils"

export interface TrailItem {
  id: string
  name: string
  state: "running" | "done" | "approval" | "error"
  input?: string
  result?: string
}

/**
 * 옴니스가 답하며 쓴 도구 — 답 위에 접힌 한 줄(「도구 3개 사용 ›」). 펼치면 부른 순서대로 세로로
 * 도구 이름 · 인자 요약 · 결과 요약. 답이 끝나도 남고, 새로고침하면 DB(실행 대화)에서 다시 그린다.
 * 옆으로 늘어놓던 칩은 도구가 많으면 답보다 길어졌다(2026-10-29 작업지시자).
 */
export function ToolTrail({ items, live = false }: { items: TrailItem[]; live?: boolean }) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (items.length === 0) return null
  const runningNow = items.some((t) => t.state === "running")
  return (
    <div className="mb-1.5 in-data-[messenger]:mb-2" data-tool-trail>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="touch-target -ml-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11.5px] in-data-[messenger]:gap-1.5 in-data-[messenger]:px-3 in-data-[messenger]:text-[14px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {live && runningNow ? <Spinner className="size-3 in-data-[messenger]:size-[16px]" /> : null}
        <span>
          도구 {items.length}개 {live && runningNow ? "쓰는 중" : "사용"}
        </span>
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={12}
          aria-hidden
          className={cn("transition-transform duration-150 in-data-[messenger]:size-[16px] motion-reduce:transition-none", open && "rotate-90")}
        />
      </button>
      {open && (
        <ol id={listId} className="mt-1 flex flex-col gap-1 border-l pl-3 in-data-[messenger]:gap-2 in-data-[messenger]:pl-4" aria-label="옴니스가 쓴 도구">
          {items.map((t) => (
            <li key={t.id} className="min-w-0 text-[11.5px] leading-[1.45] in-data-[messenger]:text-[14px] in-data-[messenger]:leading-[1.5]">
              <span className="flex items-center gap-1.5 in-data-[messenger]:gap-2">
                <StateIcon state={t.state} />
                <span className="font-medium text-foreground/85">{TOOL_LABEL[t.name] ?? t.name}</span>
                <span className="truncate text-[10.5px] text-muted-foreground/80 in-data-[messenger]:text-[12.5px]">{t.name}</span>
              </span>
              {t.input ? <span className="block break-all pl-[18px] text-muted-foreground in-data-[messenger]:pl-[24px]">{t.input}</span> : null}
              {t.result ? (
                <span className={cn("block pl-[18px] in-data-[messenger]:pl-[24px] [overflow-wrap:anywhere]", t.state === "error" ? "text-destructive" : "text-muted-foreground/80")}>
                  → {t.result}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function StateIcon({ state }: { state: TrailItem["state"] }) {
  if (state === "running") return <Spinner className="size-3 shrink-0 in-data-[messenger]:size-[16px]" />
  if (state === "error") return <HugeiconsIcon icon={Alert02Icon} size={12} aria-label="실패" className="shrink-0 text-destructive in-data-[messenger]:size-[16px]" />
  if (state === "approval") return <HugeiconsIcon icon={Clock01Icon} size={12} aria-label="확인 필요" className="shrink-0 text-amber-600 in-data-[messenger]:size-[16px]" />
  return <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} aria-label="끝남" className="shrink-0 text-emerald-600 in-data-[messenger]:size-[16px]" />
}
