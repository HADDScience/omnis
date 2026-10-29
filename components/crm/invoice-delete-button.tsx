"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"

type Reason = "reissued" | "wrong"

/**
 * 세금계산서 지우기 (2026-10-29).
 *
 * **이유를 먼저 묻는다.** 「재발급받았으니 지우고 다시 올리자」 는 수정세금계산서에선 틀린 생각이다 —
 * 당초 장을 두고 취소(−) · 재발행(+) 을 올리면 당초 승인번호로 묶여 한 번만 센다(lib/crm-receivables).
 * 당초 장을 지우면 남은 −X + X = 0 이라 「전부 취소」 로 보여 받을 돈에서 조용히 사라진다.
 * 도움말은 읽히지 않으니, 지우려는 바로 그 순간에 가르친다.
 *
 * 그 밖의 경우(잘못 올림 · 취소 뒤 일반 세금계산서로 새로 발행)는 DeleteRecordButton 처럼
 * 무엇이 함께 사라지는지 적고 지운다.
 */
export function InvoiceDeleteButton({
  invoiceId,
  label,
  approvalNo,
  payments,
  quoteCode,
  chainSheets,
}: {
  invoiceId: string
  /** "2026-10-28 · (주)그래디언트 · ₩1,100,000" */
  label: string
  approvalNo: string
  payments: { count: number; totalKrw: number }
  quoteCode: string | null
  /** 이 장이 든 수정 묶음의 장 수. 1 이면 묶음이 아니다 */
  chainSheets: number
}) {
  const router = useRouter()
  const [reason, setReason] = useState<Reason | null>(null)
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      try {
        const res = await fetch(apiUrl(`/api/crm/invoices/${invoiceId}`), { method: "DELETE" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "지우지 못했습니다")
        toast.success("세금계산서를 지웠어요")
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  const consequences = [
    ...(chainSheets > 1
      ? [`수정세금계산서 ${chainSheets}장이 한 묶음으로 세어지고 있어요. 이 장을 지우면 묶음 합계가 틀어져 받을 돈 · 매출이 어긋납니다.`]
      : []),
    ...(payments.count > 0 ? [`이 장에 적은 입금 기록 ${payments.count}건(${payments.totalKrw.toLocaleString("ko-KR")}원)도 함께 사라져요.`] : []),
    ...(quoteCode ? [`견적 ${quoteCode} 와의 연결이 풀려요.`] : []),
    "시놀로지에 올린 원본 PDF 는 그대로 남아요.",
  ]

  return (
    <AlertDialog onOpenChange={(open) => !open && setReason(null)}>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-auto gap-1 px-1.5 py-0.5 text-[12px] text-muted-foreground hover:text-destructive" />
        }
      >
        <HugeiconsIcon icon={Delete02Icon} size={13} aria-hidden />
        지우기
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>세금계산서를 왜 지우시나요?</AlertDialogTitle>
          <AlertDialogDescription>
            {label} <span className="font-mono text-[12px]">({approvalNo})</span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          <ReasonChoice active={reason === "reissued"} onClick={() => setReason("reissued")}>
            수정세금계산서로 다시 받았어요
          </ReasonChoice>
          <ReasonChoice active={reason === "wrong"} onClick={() => setReason("wrong")}>
            잘못 올렸어요 · 취소하고 일반 세금계산서로 새로 발행했어요
          </ReasonChoice>
        </div>

        {reason === "reissued" && (
          <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-[13px] leading-relaxed">
            <p className="font-medium">이 장은 지우지 않아도 돼요.</p>
            <p className="mt-1 text-muted-foreground">
              홈택스에서 받은 수정세금계산서 <b className="text-foreground">두 장 — 취소(−) 와 재발행(+)</b> 을 그대로 올리면,
              Omnis 가 이 장과 한 묶음으로 묶어 금액을 한 번만 셉니다. 재발행(+) 한 장만 올리면 매출이 두 번 잡히니 꼭 두 장 다 올려 주세요.
            </p>
          </div>
        )}

        {reason === "wrong" && (
          <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
            {consequences.map((c, i) => (
              <li key={c} className={cn("flex gap-1.5", i === 0 && chainSheets > 1 && "font-medium text-destructive")}>
                <span aria-hidden>·</span>
                <span>{c}</span>
              </li>
            ))}
            <li className="flex gap-1.5">
              <span aria-hidden>·</span>
              <span>되돌릴 수 없어요.</span>
            </li>
          </ul>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>그만두기</AlertDialogCancel>
          {reason === "reissued" && (
            <AlertDialogAction nativeButton={false} render={<Link href="/crm/invoices/new" />}>수정세금계산서 올리기</AlertDialogAction>
          )}
          {reason === "wrong" && (
            <AlertDialogAction
              onClick={remove}
              disabled={pending}
              className="gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20"
            >
              {pending && <Spinner />}
              지우기
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ReasonChoice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "touch-target rounded-lg border px-3.5 py-2.5 text-left text-[13px] transition-colors",
        active ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}
