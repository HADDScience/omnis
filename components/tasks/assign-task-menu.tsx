"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { apiUrl } from "@/lib/base-path"

/**
 * 담당 미배정 줄의 「담당 지정」 — 업무 상세의 담당자 저장과 같은 PATCH 를 부른다(알림 · 이력도 그쪽이 맡는다).
 * 한 사람만 고른다. 여러 명은 업무 상세에서 지정한다.
 */
export function AssignTaskMenu({ taskId, taskName, members }: { taskId: string; taskName: string; members: { id: string; name: string }[] }) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  async function assign(member: { id: string; name: string }) {
    setSaving(true)
    try {
      const res = await fetch(apiUrl(`/api/tasks/${taskId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeIds: [member.id] }),
      })
      if (!res.ok) throw new Error(`지정하지 못했습니다 (${res.status})`)
      toast.success(`${member.name}님을 담당으로 지정했어요`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "지정하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={saving}
        aria-label={`${taskName} 담당 지정`}
        className="touch-hit inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border px-2 text-[11.5px] font-medium transition-colors hover:bg-muted disabled:opacity-50 data-[popup-open]:bg-muted"
      >
        {saving ? "지정 중…" : "담당 지정"}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 w-40 overflow-y-auto">
        {members.map((m) => (
          <DropdownMenuItem key={m.id} className="touch-target" onClick={() => void assign(m)}>
            {m.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
