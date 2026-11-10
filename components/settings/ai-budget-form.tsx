"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiUrl } from "@/lib/base-path"
import type { RunCostBasis } from "@/lib/ai-budget-rules"
import { RunsHint } from "./runs-hint"

interface Person { id: string; name: string }

/** 관리자 — 1인 하루 · 회사 월 상한, 사람별 예외, 알림 받는 사람. 저장하면 다음 요청부터 바로 쓴다 */
export function AiBudgetForm({
  initial, people, defaults, basis,
}: {
  initial: { userDailyKrw: number; monthlyKrw: number; users: Record<string, number>; recipients: string[] }
  people: Person[]
  /** env 기본값 — 안내용 */
  defaults: { userDailyKrw: number; monthlyKrw: number }
  /** 원 → 대화 수 환산(최근 30일 실측) */
  basis: RunCostBasis
}) {
  const router = useRouter()
  const [daily, setDaily] = useState(String(initial.userDailyKrw))
  const [monthly, setMonthly] = useState(String(initial.monthlyKrw))
  const [users, setUsers] = useState<Record<string, string>>(Object.fromEntries(Object.entries(initial.users).map(([k, v]) => [k, String(v)])))
  const [recipients, setRecipients] = useState<string[]>(initial.recipients)
  const [saving, setSaving] = useState(false)

  const toNum = (v: string) => Number(v.replace(/[,\s원]/g, ""))
  const valid = (v: string) => Number.isInteger(toNum(v)) && toNum(v) > 0

  async function save() {
    if (!valid(daily) || !valid(monthly)) return toast.error("상한은 0보다 큰 원 단위 숫자로 적어 주세요")
    const bad = Object.entries(users).find(([, v]) => v.trim() !== "" && !valid(v))
    if (bad) return toast.error("사람별 상한은 비우거나 0보다 큰 숫자로 적어 주세요")
    setSaving(true)
    try {
      const res = await fetch(apiUrl("/api/ai-budget"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userDailyKrw: toNum(daily),
          monthlyKrw: toNum(monthly),
          users: Object.fromEntries(Object.entries(users).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, toNum(v)])),
          recipients,
        }),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `저장하지 못했습니다 (${res.status})`)
      toast.success("저장했어요. 다음 요청부터 바로 적용됩니다")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5" data-ai-budget-form>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">1인 하루 상한(원)</span>
          <Input inputMode="numeric" value={daily} onChange={(e) => setDaily(e.target.value)} className="h-11 md:h-9" aria-describedby="daily-hint" />
          {valid(daily) && <RunsHint krw={toNum(daily)} basis={basis} lead={`하루 ${toNum(daily).toLocaleString("ko-KR")}원 ≈`} />}
          <span id="daily-hint" className="text-xs text-muted-foreground">기본 {defaults.userDailyKrw.toLocaleString("ko-KR")}원 · 한국 시각 0시에 다시 열림</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">회사 월 상한(원)</span>
          <Input inputMode="numeric" value={monthly} onChange={(e) => setMonthly(e.target.value)} className="h-11 md:h-9" aria-describedby="monthly-hint" />
          {valid(monthly) && <RunsHint krw={toNum(monthly)} basis={basis} lead={`월 ${toNum(monthly).toLocaleString("ko-KR")}원 ≈`} />}
          <span id="monthly-hint" className="text-xs text-muted-foreground">기본 {defaults.monthlyKrw.toLocaleString("ko-KR")}원 · 80% · 100% 에 알림</span>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">사람별 하루 상한(예외)</legend>
        <p className="text-xs text-muted-foreground">비워 두면 1인 하루 상한을 따릅니다. 많이 쓰는 사람만 따로 정하세요.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <span className="w-20 shrink-0 truncate">{p.name}</span>
              <Input
                inputMode="numeric"
                placeholder={daily}
                value={users[p.id] ?? ""}
                onChange={(e) => setUsers((u) => ({ ...u, [p.id]: e.target.value }))}
                className="h-11 md:h-9"
                aria-label={`${p.name} 하루 상한`}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">알림 받는 사람(기능 요청 · 비용 80%/100%)</legend>
        <p className="text-xs text-muted-foreground">아무도 고르지 않으면 운영 알림 메일 주소와 이메일이 같은 계정이 받습니다(메일은 늘 그 주소로).</p>
        <div className="flex flex-wrap gap-2">
          {people.map((p) => {
            const on = recipients.includes(p.id)
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setRecipients((r) => (on ? r.filter((x) => x !== p.id) : [...r, p.id]))}
                className={`min-h-[44px] rounded-full border px-3.5 text-sm transition-colors md:min-h-8 md:text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {p.name}
              </button>
            )
          })}
        </div>
      </fieldset>

      <Button onClick={() => void save()} disabled={saving} className="h-11 w-full sm:w-fit md:h-9">
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  )
}
