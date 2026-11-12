"use client"

import { useMemo, useState } from "react"
import { useProgressiveCount } from "@/hooks/use-progressive-count"
import { Input } from "@/components/ui/input"
import { TaskCard, type TaskCardData } from "./task-card"
import { QuickAssignChip } from "./list-quick-assign"
import { StartWithOmnisIcon } from "./start-with-omnis"
import { HugeiconsIcon } from "@hugeicons/react"
import { Search01Icon, CheckListIcon } from "@hugeicons/core-free-icons"

/**
 * 진짜 리스트 뷰 (#6) — 칸반 그룹핑이 아닌 flat 행.
 * 보드 뷰와 시각적으로 명확히 구분되어 사용자가 두 뷰의 차이를 즉시 인지.
 */

interface TaskRowsViewProps {
  tasks: TaskCardData[]
  /** 담당 미배정 줄에 「담당 지정」 을 띄울 사람들. 없으면 칩을 그리지 않는다 */
  members?: { id: string; name: string }[]
  /** 칩에서 고른 사람 — 저장 · 되돌림은 부모(useListQuickAssign)가 맡는다 */
  /** 담당 바꾸기 — 고른 사람 전체(여러 명). 담당이 있는 업무도 겹친 아바타를 눌러 넣고 뺀다 */
  onAssign?: (task: { id: string; owners?: { id: string; name: string }[] }, people: { id: string; name: string }[]) => void
  /** 받은 순서를 지킨다 — 담당 미배정 보기는 마감순으로 받는다 */
  keepOrder?: boolean
}

const STATUS_ORDER: Record<string, number> = {
  IN_PROGRESS: 0,
  REVIEW: 1,
  TODO: 2,
  DONE: 3,
}

export function TaskRowsView({ tasks, members, onAssign, keepOrder = false }: TaskRowsViewProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? tasks.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.slug.toLowerCase().includes(q) ||
            (t.ownerSearch ?? t.ownerName ?? "").toLowerCase().includes(q) ||
            (t.projectName ?? "").toLowerCase().includes(q) ||
            (t.productName ?? "").toLowerCase().includes(q),
        )
      : tasks
    if (keepOrder) return list
    // 상태 우선순위 → 마감일 가까운 순
    return [...list].sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 9
      const sb = STATUS_ORDER[b.status] ?? 9
      if (sa !== sb) return sa - sb
      const da = a.deadline ? new Date(a.deadline).getTime() : Infinity
      const db = b.deadline ? new Date(b.deadline).getTime() : Infinity
      return da - db
    })
  }, [tasks, query, keepOrder])
  // 한 번에 다 그리면 업무 수백 건에서 뒤로 가기가 1초 넘게 멈췄다(2026-11-12) — 앞부분만 그리고 내릴 때 잇는다
  const { count: shown, more, rest, observe, showAll } = useProgressiveCount(filtered.length, 40, 60)

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
          {filtered.slice(0, shown).map((t) => {
            const canAssign = !!(members && onAssign)
            return (
              <TaskCard
                key={t.id}
                task={t}
                variant="list"
                className="min-w-0"
                assignInActions={canAssign}
                actions={
                  <>
                    {canAssign && (
                      <QuickAssignChip taskId={t.id} taskName={t.name} members={members!} current={t.owners ?? []} onAssign={(p) => onAssign!(t, p)} />
                    )}
                    <StartWithOmnisIcon taskId={t.id} taskName={t.name} />
                  </>
                }
              />
            )
          })}
          {more && (
            <button
              ref={observe}
              type="button"
              onClick={showAll}
              className="rounded-md border border-dashed p-3 text-center text-[12px] text-muted-foreground hover:bg-muted/50"
            >
              {rest}건 더 보기
            </button>
          )}
        </div>
      )}
    </div>
  )
}
