"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { TaskCard, type TaskCardData } from "./task-card"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, CheckListIcon } from "@hugeicons/core-free-icons"

/**
 * 진짜 리스트 뷰 (#6) — 칸반 그룹핑이 아닌 flat 행.
 * 보드 뷰와 시각적으로 명확히 구분되어 사용자가 두 뷰의 차이를 즉시 인지.
 */

interface TaskRowsViewProps {
  tasks: TaskCardData[]
}

const STATUS_ORDER: Record<string, number> = {
  IN_PROGRESS: 0,
  REVIEW: 1,
  TODO: 2,
  DONE: 3,
}

export function TaskRowsView({ tasks }: TaskRowsViewProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? tasks.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            (t.ownerName ?? "").toLowerCase().includes(q) ||
            (t.projectName ?? "").toLowerCase().includes(q) ||
            (t.productName ?? "").toLowerCase().includes(q),
        )
      : tasks
    // 상태 우선순위 → 마감일 가까운 순
    return [...list].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9
      const sb = STATUS_ORDER[b.status] ?? 9
      if (sa !== sb) return sa - sb
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
      return da - db
    })
  }, [tasks, query])

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="relative max-w-sm">
        <HugeiconsIcon
          icon={Search01Icon}
          size={14}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="업무명 / 담당자 / 제품 검색"
          className="h-8 pl-8 text-[12.5px]"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed py-12 text-muted-foreground">
          <HugeiconsIcon icon={CheckListIcon} size={28} />
          <p className="text-[13px]">
            {query ? `"${query}" 검색 결과가 없습니다.` : "등록된 업무가 없습니다."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((t) => (
            <TaskCard key={t.id} task={t} variant="list" />
          ))}
        </div>
      )}
    </div>
  )
}
