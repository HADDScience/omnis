"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import { QUOTE_STATUS_LABEL } from "@/lib/crm"
import { CrmQuoteStatus } from "@/generated/prisma"
import { cn } from "@/lib/utils"

/**
 * 견적 상태를 바꾼다.
 *
 * 드롭다운이 아니라 줄로 펼쳐 둔 이유는, 상태가 넷뿐이고 **어디까지 왔는지**가
 * 한눈에 보여야 하기 때문이다. 드롭다운은 열어 봐야 지금 값을 알 수 있다.
 *
 * 순서는 실제 흐름을 따른다: 작성중 → 발송 → 완료. 취소는 흐름 밖이라 떼어 둔다.
 */
const FLOW: CrmQuoteStatus[] = [
  CrmQuoteStatus.DRAFT,
  CrmQuoteStatus.SENT,
  CrmQuoteStatus.DONE,
]

export function QuoteStatusControl({
  quoteId,
  status: initial,
  taxInvoicedAt,
}: {
  quoteId: string
  status: CrmQuoteStatus
  taxInvoicedAt: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<CrmQuoteStatus | null>(null)

  function change(next: CrmQuoteStatus) {
    if (next === status || pending) return
    const prev = status
    setStatus(next) // 먼저 바꾸고, 실패하면 되돌린다
    setBusyKey(next)
    startTransition(async () => {
      try {
        const res = await fetch(`/api/crm/quotes/${quoteId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "상태를 바꾸지 못했습니다")
        toast.success(`${QUOTE_STATUS_LABEL[next]} 로 바꿨어요`)
        // 세금계산서 날짜가 자동으로 채워질 수 있어 화면을 새로 읽는다
        router.refresh()
      } catch (e) {
        setStatus(prev)
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      } finally {
        setBusyKey(null)
      }
    })
  }

  const cancelled = status === CrmQuoteStatus.CANCELLED

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FLOW.map((s, i) => {
          const active = status === s
          const passed = !cancelled && FLOW.indexOf(status) > i
          return (
            <div key={s} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden className="text-[11px] text-muted-foreground">›</span>}
              <button
                type="button"
                onClick={() => change(s)}
                disabled={pending}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors disabled:opacity-60",
                  active
                    ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                    : passed
                      ? "text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {busyKey === s ? (
                  <Spinner />
                ) : passed ? (
                  <HugeiconsIcon icon={Tick02Icon} size={13} aria-hidden />
                ) : null}
                {QUOTE_STATUS_LABEL[s]}
              </button>
            </div>
          )
        })}

        <button
          type="button"
          onClick={() => change(CrmQuoteStatus.CANCELLED)}
          disabled={pending}
          aria-pressed={cancelled}
          className={cn(
            "ml-2 inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] transition-colors disabled:opacity-60",
            cancelled
              ? "border-destructive/30 bg-destructive/10 font-semibold text-destructive"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {busyKey === CrmQuoteStatus.CANCELLED && <Spinner />}
          {QUOTE_STATUS_LABEL[CrmQuoteStatus.CANCELLED]}
        </button>
      </div>

      {status === CrmQuoteStatus.DONE && !taxInvoicedAt && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          완료로 바꾸면 세금계산서 발행일이 오늘로 채워집니다. 이미 적힌 날짜는 그대로 둡니다.
        </p>
      )}
    </div>
  )
}
