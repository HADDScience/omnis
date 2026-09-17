"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

/** 「이 세금계산서가 맞아요」 — 견적 화면에서 한 번 눌러 잇는다 */
export function LinkInvoiceButton({ invoiceId, quoteId, label }: { invoiceId: string; quoteId: string; label: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await fetch(apiUrl(`/api/crm/invoices/${invoiceId}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ quoteId }),
          }).catch(() => null)
          if (!res?.ok) {
            toast.error("잇지 못했습니다")
            return
          }
          toast.success("이 견적에 이었어요")
          router.refresh()
        })
      }
      className="touch-target flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left text-[12.5px] transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60"
    >
      {pending && <Spinner className="h-3.5 w-3.5" />}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="shrink-0 text-primary">이 세금계산서가 맞아요</span>
    </button>
  )
}
