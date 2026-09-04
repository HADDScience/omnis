"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon, PackageIcon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface Sample {
  id: string
  code: string
  requestedAt: string
  orgName: string
  orgId: string
  contactName: string | null
  productName: string | null
  request: string | null
  referral: string | null
  sent: boolean
  note: string | null
}

/**
 * 샘플요청 목록.
 *
 * 발송 여부는 목록에서 바로 누른다 — 상세로 들어갔다 나올 일이 아니다.
 * 엑셀에서도 드롭다운 한 칸이었다.
 */
export function SampleList({ samples: initial }: { samples: Sample[] }) {
  const [samples, setSamples] = useState(initial)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return samples
    return samples.filter((s) =>
      `${s.orgName} ${s.contactName ?? ""} ${s.productName ?? ""} ${s.request ?? ""} ${s.referral ?? ""}`
        .toLowerCase()
        .includes(t)
    )
  }, [samples, q])

  const pending = samples.filter((s) => !s.sent).length

  async function toggle(s: Sample) {
    setBusy(s.id)
    const next = !s.sent
    // 낙관적으로 먼저 바꾼다. 실패하면 되돌린다 — 누를 때마다 기다리게 하지 않는다.
    setSamples((prev) => prev.map((x) => (x.id === s.id ? { ...x, sent: next } : x)))
    try {
      const res = await fetch("/api/crm/samples", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: s.id, sent: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "바꾸지 못했습니다")
    } catch (e) {
      setSamples((prev) => prev.map((x) => (x.id === s.id ? { ...x, sent: !next } : x)))
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[18px] font-bold tracking-[-0.02em]">샘플요청</h1>
        <span className="text-[13px] text-muted-foreground">
          {samples.length}건{pending > 0 && ` · 미발송 ${pending}건`}
        </span>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="기관 · 담당자 · 제품 · 소개경로로 찾기"
          aria-label="샘플요청 검색"
          className="ml-auto h-8 w-full max-w-[280px]"
        />
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border bg-card px-6 py-16 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon icon={PackageIcon} size={20} aria-hidden />
          </div>
          <p className="text-[14px] font-semibold">
            {q ? "찾는 요청이 없습니다" : "아직 샘플요청이 없습니다"}
          </p>
          {q && (
            <p className="mt-1 text-[13px] text-muted-foreground">다른 말로 찾아보세요.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((s) => (
            <div key={s.id} className="rounded-xl border bg-card p-3.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{s.code}</span>
                <span className="text-[12px] text-muted-foreground">{s.requestedAt}</span>
                <Link
                  href={`/crm/orgs/${s.orgId}`}
                  className="text-[14px] font-semibold hover:underline"
                >
                  {s.orgName}
                </Link>
                {s.contactName && (
                  <span className="text-[12px] text-muted-foreground">{s.contactName}</span>
                )}
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  disabled={busy === s.id}
                  aria-pressed={s.sent}
                  className={cn(
                    "ml-auto inline-flex h-7 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[12px] transition-colors disabled:opacity-60",
                    s.sent
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    size={13}
                    className={s.sent ? "" : "opacity-30"}
                    aria-hidden
                  />
                  {s.sent ? "발송완료" : "미발송"}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                {s.productName && <Badge variant="outline">{s.productName}</Badge>}
                {s.request && <span className="min-w-0 flex-1">{s.request}</span>}
              </div>

              {(s.referral || s.note) && (
                <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  {s.referral && <span>소개: {s.referral}</span>}
                  {s.note && <span>{s.note}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
