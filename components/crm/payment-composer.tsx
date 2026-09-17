"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Step } from "./step"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"

/**
 * 입금 확인 — 새로 만들기의 한 갈래 (2026-09-17).
 *
 * 재무 담당이 실제로 하는 일은 「통장 내역을 보며 들어온 돈을 하나씩 짝짓기」 다. 그래서:
 *   1. 어느 세금계산서에 들어온 돈인가요? — 받을 돈만, 오래 기다린 것부터. 늦은 것은 붉게
 *   2. 언제, 얼마 들어왔나요?            — 남은 금액이 이미 채워져 있다. 다르면 고친다
 *   3. 저장                              — 저장하면 **같은 화면에서 다음 건**으로 이어진다
 *
 * 한 건 적고 목록으로 돌아갔다가 다시 들어오는 왕복을 없앤다.
 */

export interface OutstandingChain {
  invoiceId: string
  issuedOn: string
  counterName: string
  quoteCode: string | null
  total: number
  paid: number
  remaining: number
  days: number
  overdue: boolean
  sheets: number
}

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`
const today = () => new Date().toISOString().slice(0, 10)

export function PaymentComposer({ chains: initial, preselect }: { chains: OutstandingChain[]; preselect: string | null }) {
  const router = useRouter()
  const [chains, setChains] = useState(initial)
  const [invoiceId, setInvoiceId] = useState<string | null>(preselect && initial.some((c) => c.invoiceId === preselect) ? preselect : null)
  const [paidOn, setPaidOn] = useState(today)
  const [amount, setAmount] = useState<number>(() => initial.find((c) => c.invoiceId === preselect)?.remaining ?? 0)
  const [note, setNote] = useState("")
  const [query, setQuery] = useState("")
  const [pending, startTransition] = useTransition()
  const [savedCount, setSavedCount] = useState(0)

  const picked = chains.find((c) => c.invoiceId === invoiceId) ?? null
  const shown = useMemo(() => {
    const q = query.trim()
    return q ? chains.filter((c) => c.counterName.includes(q) || (c.quoteCode ?? "").includes(q) || String(c.remaining).includes(q.replace(/,/g, ""))) : chains
  }, [chains, query])

  function pick(c: OutstandingChain) {
    setInvoiceId(c.invoiceId)
    setAmount(c.remaining)
    setNote("")
  }

  const canSave = !!picked && amount > 0 && amount <= picked.remaining && !!paidOn && !pending

  function save() {
    if (!picked || !canSave) return
    startTransition(async () => {
      const res = await fetch(apiUrl("/api/crm/payments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: picked.invoiceId, paidOn, amountKrw: amount, note: note || null }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (!res?.ok) {
        toast.error(data?.error ?? "저장하지 못했습니다")
        return
      }
      const left = picked.remaining - amount
      toast.success(left > 0 ? `${picked.counterName} ${won(amount)} 적었어요 · ${won(left)} 남음` : `${picked.counterName} 다 받았어요`)
      // 같은 화면에서 다음 건으로 — 다 받은 건은 목록에서 빠지고, 일부만 받은 건은 남은 금액이 준다
      setChains((prev) =>
        prev.flatMap((c) => (c.invoiceId !== picked.invoiceId ? [c] : left > 0 ? [{ ...c, paid: c.paid + amount, remaining: left }] : []))
      )
      setInvoiceId(null)
      setAmount(0)
      setNote("")
      setSavedCount((n) => n + 1)
      router.refresh()
    })
  }

  const overdueCount = chains.filter((c) => c.overdue).length
  const totalRemaining = chains.reduce((a, c) => a + c.remaining, 0)

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 pb-24 pt-8">
      <h1 className="text-[20px] font-bold tracking-[-0.02em]">입금 확인</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {chains.length
          ? `받을 돈 ${chains.length}건 · ${won(totalRemaining)}${overdueCount ? ` · 30일 넘은 것 ${overdueCount}건` : ""}`
          : "받을 돈이 없습니다."}
        {savedCount > 0 && ` · 방금 ${savedCount}건 적음`}
      </p>

      <div className="mt-7 flex flex-col gap-5">
        {/* 1 — 어느 세금계산서 */}
        <Step show={chains.length > 0} label="어느 세금계산서에 들어온 돈인가요?" hint="오래 기다린 것부터">
          {chains.length > 6 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="거래처 · 금액으로 찾기"
              aria-label="받을 돈 찾기"
              className="mb-2"
            />
          )}
          <ul className="flex max-h-[360px] flex-col gap-1.5 overflow-y-auto">
            {shown.map((c) => (
              <li key={c.invoiceId}>
                <button
                  type="button"
                  aria-pressed={c.invoiceId === invoiceId}
                  onClick={() => pick(c)}
                  className={cn(
                    "touch-target flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                    c.invoiceId === invoiceId ? "border-primary bg-primary/5" : "hover:bg-muted/50"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{c.counterName}</span>
                  <span className="tabular-nums">{won(c.remaining)}</span>
                  <span className="w-full text-[11.5px] text-muted-foreground">
                    {c.issuedOn} 발행 ·{" "}
                    <span className={cn(c.overdue && "font-medium text-destructive")}>{c.days}일째</span>
                    {c.paid > 0 && ` · ${won(c.paid)} 받음`}
                    {c.quoteCode && ` · 견적 ${c.quoteCode}`}
                    {c.sheets > 1 && ` · 수정 포함 ${c.sheets}장`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Step>

        {/* 2 — 언제 얼마 */}
        <Step show={!!picked} autoFocus label="언제, 얼마 들어왔나요?" hint={picked ? `남은 금액 ${won(picked.remaining)}` : undefined}>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} aria-label="입금일" />
            <Input
              inputMode="numeric"
              value={amount ? amount.toLocaleString("ko-KR") : ""}
              onChange={(e) => setAmount(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
              aria-label="입금액"
              className="text-right tabular-nums"
            />
          </div>
          {picked && amount > 0 && amount < picked.remaining && (
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">일부 입금으로 적어요 — {won(picked.remaining - amount)} 이 남습니다.</p>
          )}
          {picked && amount > picked.remaining && (
            <p className="mt-1.5 text-[11.5px] text-destructive">남은 금액보다 많아요.</p>
          )}
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택) — 입금자명이 다를 때 등" className="mt-2" />
          <Button onClick={save} disabled={!canSave} size="lg" className="mt-4 w-full gap-1.5">
            {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
            입금 적기
          </Button>
        </Step>

        {chains.length > 0 && !picked && (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={ArrowRight02Icon} size={13} aria-hidden />
            들어온 돈에 맞는 세금계산서를 고르면 금액이 채워집니다
          </p>
        )}
      </div>
    </div>
  )
}
