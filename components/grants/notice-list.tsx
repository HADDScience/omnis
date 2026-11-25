"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  LinkSquare02Icon,
  PlusSignIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { send } from "@/components/grants/send"
import { seoulYmd } from "@/lib/grants-labels"
import { cn } from "@/lib/utils"

export interface NoticeView {
  id: string
  key: string
  title: string
  org: string | null
  url: string | null
  deadline: string | null
  deadlineRaw: string | null
  region: string | null
  fields: string[]
  isRnd: boolean | null
  verdict: string
  reasons: { claim: string; quote: string }[]
  judgedBy: string | null
  decided: boolean
}

const VERDICT_CHIP: Record<string, string> = {
  해당: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  애매: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  비해당: "bg-muted text-muted-foreground",
  불명: "bg-muted text-muted-foreground",
}

/** 수집기 원문 기간 — 2026-11-06T09:00:00 → 2026-11-06 09:00 */
const rawPeriod = (s: string) => s.replace(/T(\d{2}:\d{2}):\d{2}/g, " $1")

function due(iso: string | null, raw: string | null) {
  if (!iso) return raw ? rawPeriod(raw) : "마감 미정"
  const day = seoulYmd(iso)!
  const left = Math.round(
    (new Date(`${day}T00:00:00+09:00`).getTime() -
      new Date(`${seoulYmd(new Date())}T00:00:00+09:00`).getTime()) /
      86_400_000
  )
  return left < 0
    ? `마감 ${day}`
    : left === 0
      ? "오늘 마감"
      : `D-${left} · ${day}`
}

export function NoticeList({ rows }: { rows: NoticeView[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (rows.length === 0)
    return (
      <p className="glass rounded-2xl p-4 text-[13px] text-muted-foreground">
        공고가 없습니다.
      </p>
    )
  return (
    <ul className="glass divide-y divide-[var(--glass-edge)] overflow-hidden rounded-2xl">
      {rows.map((r) => (
        <NoticeRow
          key={r.id}
          r={r}
          open={open === r.id}
          onToggle={() => setOpen(open === r.id ? null : r.id)}
        />
      ))}
    </ul>
  )
}

function NoticeRow({
  r,
  open,
  onToggle,
}: {
  r: NoticeView
  open: boolean
  onToggle: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [decided, setDecided] = useState(r.decided)

  async function raise() {
    setBusy(true)
    try {
      await send("/api/grants/decisions", "POST", { noticeId: r.id })
      setDecided(true)
      toast.success(`「우리 결정」 에 올렸습니다 · ${r.title}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "올리지 못했습니다")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${r.title} ${open ? "접기" : "펼치기"}`}
          onClick={onToggle}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2.5 pl-3 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
        >
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium",
                  VERDICT_CHIP[r.verdict] ?? VERDICT_CHIP.불명
                )}
              >
                {r.verdict}
              </span>
              <span className="truncate text-[13.5px] font-semibold">
                {r.title}
              </span>
            </span>
            <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
              <span>{due(r.deadline, r.deadlineRaw)}</span>
              {r.org && <span className="max-w-[16rem] truncate">{r.org}</span>}
              {r.region && <span>{r.region}</span>}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
              open && "rotate-180"
            )}
          />
        </button>
        <div className="shrink-0 pr-2">
          {decided ? (
            <span className="inline-flex h-8 items-center gap-1 px-2 text-[12px] text-muted-foreground">
              <HugeiconsIcon
                icon={Tick02Icon}
                strokeWidth={2}
                className="size-3.5"
              />
              올림
            </span>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="glass h-8 rounded-full px-3"
              onClick={raise}
              disabled={busy}
              aria-label={`${r.title} 우리 결정에 올리기`}
            >
              {busy ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HugeiconsIcon
                  icon={PlusSignIcon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
              )}
              올리기
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3">
          <div className="rounded-xl bg-background/50 p-3 text-[12px]">
            {r.reasons.length > 0 && (
              <ul className="space-y-1.5">
                {r.reasons.map((x, i) => (
                  <li key={i}>
                    <p>{x.claim}</p>
                    {x.quote && (
                      <p className="mt-0.5 border-l-2 border-border pl-2 text-muted-foreground">
                        {x.quote}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-[84px_1fr]">
              {r.deadlineRaw && (
                <>
                  <dt className="text-muted-foreground">접수</dt>
                  <dd>{rawPeriod(r.deadlineRaw)}</dd>
                </>
              )}
              {r.fields.length > 0 && (
                <>
                  <dt className="text-muted-foreground">분야</dt>
                  <dd>{r.fields.join(" · ")}</dd>
                </>
              )}
              {r.isRnd !== null && (
                <>
                  <dt className="text-muted-foreground">구분</dt>
                  <dd>{r.isRnd ? "R&D" : "비R&D"}</dd>
                </>
              )}
              <dt className="text-muted-foreground">판정</dt>
              <dd>{r.judgedBy === "llm" ? "공고 본문 검토" : "규칙"}</dd>
            </dl>
          </div>
          {r.url && (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[12px] hover:underline"
            >
              공고 원문
              <HugeiconsIcon
                icon={LinkSquare02Icon}
                strokeWidth={2}
                className="size-3.5"
                aria-hidden
              />
            </a>
          )}
        </div>
      )}
    </li>
  )
}
