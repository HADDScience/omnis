"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { apiUrl } from "@/lib/base-path"

interface Person {
  id: string
  name: string
}

/**
 * 채용 담당 고르기 — 관리자 › 운영. 고른 사람만 지원서함을 연다(관리자라도 고르지 않으면 못 본다).
 * 아무도 고르지 않으면 아무도 못 본다 — 새 지원서가 오면 관리자에게 「담당이 없다」 만 간다.
 */
export function HrReviewersForm({ initial, people }: { initial: string[]; people: Person[] }) {
  const router = useRouter()
  const [chosen, setChosen] = useState<string[]>(initial)
  const [saving, setSaving] = useState(false)
  const dirty = chosen.length !== initial.length || chosen.some((id) => !initial.includes(id))

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(apiUrl("/api/hr/reviewers"), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: chosen }),
      })
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `저장하지 못했습니다 (${res.status})`)
      toast.success("저장했어요. 바로 적용됩니다")
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-hr-reviewers-form>
      <div className="flex flex-wrap gap-2">
        {people.map((p) => {
          const on = chosen.includes(p.id)
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={on}
              data-hr-reviewer={p.name}
              onClick={() => setChosen((r) => (on ? r.filter((x) => x !== p.id) : [...r, p.id]))}
              className={`min-h-[44px] rounded-full border px-3.5 text-sm transition-colors md:min-h-8 md:text-xs ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              {p.name}
            </button>
          )
        })}
      </div>
      <Button onClick={() => void save()} disabled={saving || !dirty} className="h-11 w-full sm:w-fit md:h-9">
        {saving ? "저장 중…" : "저장"}
      </Button>
    </div>
  )
}
