"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { apiUrl } from "@/lib/base-path"
import { FEATURE_STATUSES, FEATURE_STATUS_LABEL, type FeatureStatus } from "@/lib/feature-requests-shared"

/** 기능 요청 한 줄의 상태 단추 — 새로 · 검토 · 완료. 실패하면 되돌린다 */
export function FeatureStatusButtons({ id, status: initial }: { id: string; status: FeatureStatus }) {
  const router = useRouter()
  const [status, setStatus] = useState(initial)
  const [saving, setSaving] = useState(false)

  async function change(next: FeatureStatus) {
    if (next === status || saving) return
    const before = status
    setStatus(next)
    setSaving(true)
    try {
      const res = await fetch(apiUrl(`/api/feature-requests/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) throw new Error(`바꾸지 못했습니다 (${res.status})`)
      router.refresh()
    } catch (err) {
      setStatus(before)
      toast.error(err instanceof Error ? err.message : "바꾸지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="group" aria-label="상태" className="inline-flex shrink-0 overflow-hidden rounded-md border">
      {FEATURE_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={s === status}
          disabled={saving}
          onClick={() => void change(s)}
          className={`min-h-[36px] px-3 text-xs transition-colors ${s === status ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
        >
          {FEATURE_STATUS_LABEL[s]}
        </button>
      ))}
    </div>
  )
}
