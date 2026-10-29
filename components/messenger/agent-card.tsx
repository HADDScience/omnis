"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, CheckmarkCircle02Icon, SquareLock02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { AgentCard as Card } from "@/lib/agent/service"

const STATUS: Record<Card["status"], { label: string; tone: string }> = {
  PENDING: { label: "확인 대기", tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300" },
  APPROVED: { label: "실행 중", tone: "bg-primary/10 text-primary" },
  EXECUTED: { label: "실행됨", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  REJECTED: { label: "취소함", tone: "bg-muted text-muted-foreground" },
  BLOCKED: { label: "막음", tone: "bg-destructive/10 text-destructive" },
  FAILED: { label: "실패", tone: "bg-destructive/10 text-destructive" },
  EXPIRED: { label: "지나감", tone: "bg-muted text-muted-foreground" },
}

/**
 * 쓰기 제안 카드 — 무엇을(대상) · 어떻게(전 → 후) · 확인하면 무슨 일이(위험 이유). [확인] 을 눌러야 실행된다.
 * 막힌 카드(비밀 · 대상 없음)는 버튼 없이 이유만 보인다.
 */
export function AgentCard({
  card,
  deciding,
  disabled,
  onDecide,
}: {
  card: Card
  deciding: "approve" | "reject" | null
  disabled: boolean
  onDecide: (decision: "approve" | "reject") => void
}) {
  const p = card.preview
  const s = STATUS[card.status]
  const pending = card.status === "PENDING"
  return (
    <section
      aria-label={`옴니스 제안: ${p.title}`}
      className={cn(
        "mt-3 ml-[38px] rounded-xl border bg-card",
        pending && "border-amber-500/40 shadow-[0_2px_10px_rgba(0,0,0,0.05)]",
        card.status === "BLOCKED" && "border-destructive/40",
      )}
      data-agent-card={card.status}
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
        <span className="text-[13px] font-semibold">{p.title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", s.tone)}>{s.label}</span>
        <span className="min-w-0 basis-full break-keep text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{p.target}</span>
      </header>

      {p.changes.length > 0 && (
        <dl className="divide-y text-[12.5px]">
          {p.changes.map((c, i) => (
            <div key={i} className="grid grid-cols-[5.5em_minmax(0,1fr)] gap-x-2 px-3.5 py-2 sm:grid-cols-[7em_minmax(0,1fr)]">
              <dt className="text-muted-foreground">{c.label}</dt>
              <dd className="min-w-0 break-keep [overflow-wrap:anywhere]">
                {c.before !== null && (
                  <>
                    <span className="whitespace-pre-wrap text-muted-foreground line-through decoration-muted-foreground/50">{c.before}</span>
                    <span aria-label="에서" className="px-1.5 text-muted-foreground">→</span>
                  </>
                )}
                <span className="whitespace-pre-wrap font-medium">{c.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {card.status === "BLOCKED" && card.blockedReason ? (
        <p className="flex gap-2 border-t bg-destructive/5 px-3.5 py-2.5 text-[12.5px] text-destructive" role="alert">
          <HugeiconsIcon icon={SquareLock02Icon} size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span className="break-keep">{card.blockedReason}</span>
        </p>
      ) : (
        p.risk && (
          <p className="flex gap-2 border-t px-3.5 py-2.5 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={Alert02Icon} size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span className="break-keep">확인하면 — {p.risk}</span>
          </p>
        )
      )}

      {card.result && (card.status === "EXECUTED" || card.status === "FAILED") && (
        <p
          className={cn(
            "flex gap-2 border-t px-3.5 py-2.5 text-[12.5px]",
            card.status === "EXECUTED" ? "text-emerald-700 dark:text-emerald-300" : "text-destructive",
          )}
        >
          {card.status === "EXECUTED" && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={15} className="mt-0.5 shrink-0" aria-hidden />}
          <span className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{card.result}</span>
        </p>
      )}

      {pending && (
        <div className="flex justify-end gap-2 border-t px-3 py-2.5">
          <Button
            variant="outline"
            size="sm"
            className="touch-target"
            disabled={disabled || deciding !== null}
            onClick={() => onDecide("reject")}
          >
            {deciding === "reject" && <Spinner />}
            취소
          </Button>
          <Button size="sm" className="touch-target" disabled={disabled || deciding !== null} onClick={() => onDecide("approve")}>
            {deciding === "approve" && <Spinner />}
            확인
          </Button>
        </div>
      )}
    </section>
  )
}
