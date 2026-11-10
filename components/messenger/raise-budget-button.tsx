"use client"

import { useState } from "react"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import type { BudgetBlock } from "@/lib/ai-budget-rules"

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`

/**
 * 상한 도달 안내 옆 「한도 올리기」 — 관리자에게만 보인다(서버가 canRaise 를 준다).
 * 한 번 누르면 새 값을 보여 주고, 한 번 더(확인) 눌러야 올린다. 브라우저 확인 창은 쓰지 않는다.
 */
export function RaiseBudgetButton({ budget, onRaised }: { budget: BudgetBlock; onRaised: () => void }) {
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const what = budget.kind === "monthly" ? "회사 월 한도" : "이 사람 하루 한도"

  async function raise() {
    setSaving(true)
    try {
      const res = await fetch(apiUrl("/api/ai-budget/raise"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          budget.kind === "monthly"
            ? { kind: "monthly", toKrw: budget.suggestKrw }
            : { kind: "user_daily", userId: budget.userId, toKrw: budget.suggestKrw },
        ),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? `올리지 못했습니다 (${res.status})`)
      toast.success(`${what}를 ${won(budget.suggestKrw)}으로 올렸어요. 다시 보내 보세요`)
      onRaised()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "올리지 못했습니다")
      setAsking(false)
    } finally {
      setSaving(false)
    }
  }

  if (!asking) {
    return (
      <button
        type="button"
        data-raise-budget
        onClick={() => setAsking(true)}
        className="touch-hit ml-2 inline-flex items-center rounded-md border border-amber-600/50 px-2 py-0.5 font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950"
      >
        한도 올리기
      </button>
    )
  }
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-1.5">
      <span>
        {what} {won(budget.limitKrw)} → {won(budget.suggestKrw)}?
      </span>
      <button
        type="button"
        data-raise-budget-confirm
        disabled={saving}
        onClick={() => void raise()}
        className="touch-hit inline-flex items-center rounded-md bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {saving ? "올리는 중…" : "올리기"}
      </button>
      <button type="button" disabled={saving} onClick={() => setAsking(false)} className="touch-hit inline-flex items-center px-1.5 py-0.5 text-muted-foreground hover:underline">
        취소
      </button>
    </span>
  )
}
