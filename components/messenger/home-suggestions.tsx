"use client"

// 첫 화면 「지금 할 일」 카드 — 그 사람이 지금 할 일을 옴니스가 골라 보인다(lib/home-suggestions).
// 누르면 그 일을 하는 화면으로 가거나, 옴니스에게 그 일을 묻는다. 노출 · 클릭은 trigger 별 비교를 위해 남긴다.
// 제안이 없으면 예시 질문(fallback)을 그대로 보인다.
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { AtIcon, Award01Icon, Calendar03Icon, CheckmarkCircle02Icon, UserMultiple02Icon } from "@hugeicons/core-free-icons"
import { Skeleton } from "@/components/ui/skeleton"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import type { HomeSuggestions } from "@/lib/home-suggestions/server"
import { dueWord, type CandidateKind, type SuggestionItem } from "@/lib/home-suggestions/rules"

const ICON: Record<CandidateKind, typeof AtIcon> = {
  approval: CheckmarkCircle02Icon,
  task_due: Calendar03Icon,
  mention: AtIcon,
  grant_due: Award01Icon,
  applications: UserMultiple02Icon,
}

const CARD =
  "glass touch-target flex w-full items-start gap-3 rounded-2xl px-3.5 py-3 text-left text-[13px] leading-[1.5] transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 in-data-[messenger]:rounded-[22px] in-data-[messenger]:px-[18px] in-data-[messenger]:py-[14px] in-data-[messenger]:text-[16px]"

function send(body: { runId: string; itemKey: string; kind: "impression" | "click" }) {
  void fetch(apiUrl("/api/home/suggestions/events"), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive: true,
  }).catch(() => {})
}

export function HomeSuggestionCards({ embedded = false, onAsk, fallback }: {
  embedded?: boolean
  onAsk: (prompt: string) => void
  /** 제안할 일이 없을 때(또는 불러오지 못했을 때) 보일 것 */
  fallback: React.ReactNode
}) {
  const router = useRouter()
  const [data, setData] = useState<HomeSuggestions | null | "failed">(null)
  const seen = useRef<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    fetch(apiUrl("/api/home/suggestions"), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<HomeSuggestions>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData("failed") })
    return () => { alive = false }
  }, [])

  // 노출 — 실행 · 카드마다 한 번
  useEffect(() => {
    if (!data || data === "failed" || !data.runId) return
    for (const it of data.items) {
      const k = `${data.runId}:${it.key}`
      if (seen.current.has(k)) continue
      seen.current.add(k)
      send({ runId: data.runId, itemKey: it.key, kind: "impression" })
    }
  }, [data])

  const grid = cn("grid w-full max-w-[560px] gap-2 in-data-[messenger]:gap-3", !embedded && "sm:grid-cols-2")

  if (data === null) {
    return (
      <div className={grid} data-home-suggestions="loading" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn(CARD, "pointer-events-none")}>
            <Skeleton className="size-5 shrink-0 rounded-md" />
            <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
              <Skeleton className="h-3.5 w-[85%] in-data-[messenger]:h-4" />
              <Skeleton className="h-3 w-[40%]" />
            </div>
          </div>
        ))}
      </div>
    )
  }
  if (data === "failed" || data.items.length === 0) return <>{fallback}</>

  const pick = (it: SuggestionItem) => {
    if (data.runId) send({ runId: data.runId, itemKey: it.key, kind: "click" })
    if (it.action.type === "ask") onAsk(it.action.prompt)
    else router.push(it.action.href)
  }
  const now = new Date()
  return (
    <div className={grid} data-home-suggestions={data.source ?? "none"}>
      {data.items.map((it) => {
        const due = dueWord(it.due, now)
        return (
          <button key={it.key} type="button" onClick={() => pick(it)} className={CARD} data-suggestion-kind={it.kind}>
            <HugeiconsIcon icon={ICON[it.kind]} size={18} className="mt-0.5 shrink-0 text-primary in-data-[messenger]:size-[21px]" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="break-keep font-medium [overflow-wrap:anywhere]">{it.line}</span>
              {due && !it.line.includes(due) && (
                <span className={cn("text-[11.5px] text-muted-foreground in-data-[messenger]:text-[13.5px]", due.includes("지남") && "text-destructive")}>{due}</span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}
