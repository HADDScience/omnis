"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiUrl } from "@/lib/base-path"
import { assignSummary, canSaveAssignees, pruneAssignOverrides, toggleAssignee, type AssignOverrides } from "@/lib/quick-assign"
import { cn } from "@/lib/utils"
import { AssigneeChips } from "./quick-assign"
import { AssigneeStack } from "./assignee-stack"

type Person = { id: string; name: string }

/**
 * 업무 목록 · 보드에서 담당 지정(2026-11-10, 여러 명 · 해제 2026-11-11). 업무 상세와 같은 PATCH /api/tasks/[id] 의
 * assigneeIds(담당 전체) — 저장은 차이만, 권한 · 새로 지정된 사람 알림 · 이력은 lib/task-update.ts 가 맡는다.
 * 고르면 화면을 먼저 바꾸고(덮어쓰기), 실패하면 되돌린다. 성공하면 서버 값을 다시 받아 덮어쓰기를 걷는다.
 */
export function useListQuickAssign() {
  const router = useRouter()
  const [overrides, setOverrides] = useState<AssignOverrides>({})

  const assign = useCallback(
    async (task: { id: string; owners?: Person[] }, people: Person[]) => {
      const before = (task.owners ?? []).map((p) => p.id)
      setOverrides((o) => ({ ...o, [task.id]: people }))
      try {
        const res = await fetch(apiUrl(`/api/tasks/${task.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeIds: people.map((p) => p.id) }),
        })
        if (!res.ok) throw new Error(`지정하지 못했습니다 (${res.status})`)
        toast.success(assignSummary(before, people.map((p) => p.id), [...(task.owners ?? []), ...people]))
        router.refresh()
      } catch (err) {
        setOverrides((o) => {
          const rest = { ...o }
          delete rest[task.id]
          return rest
        })
        toast.error(err instanceof Error ? err.message : "지정하지 못했습니다")
      }
    },
    [router],
  )

  const prune = useCallback((tasks: { id: string; owners?: Person[] }[]) => {
    setOverrides((o) => pruneAssignOverrides(o, tasks))
  }, [])

  return { overrides, assign, prune }
}

/**
 * 업무 행 · 카드 안의 담당 단추. 담당이 없으면 붉은 「담당 지정」 칩, 있으면 겹친 아바타가 단추다.
 * 누르면 PC 는 팝오버, 폰은 바텀시트 — 지금 담당이 미리 골라진 칩에서 넣고 빼고 「저장」.
 * 보이는 크기는 작게, 누르는 자리는 44px(touch-hit).
 */
export function QuickAssignChip({
  taskId,
  taskName,
  members,
  current = [],
  onAssign,
  className,
}: {
  taskId: string
  taskName: string
  members: Person[]
  /** 지금 담당 — 미리 골라 둔다. 과거 구성원이어도 칩으로 남아 해제할 수 있다 */
  current?: Person[]
  onAssign: (people: Person[]) => void
  className?: string
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const currentIds = current.map((p) => p.id)
  // 지금 담당 중 구성원 목록에 없는 사람(과거 구성원)도 해제할 수 있게 칩으로 둔다
  const choices = [
    ...members,
    ...current.filter((p) => !members.some((m) => m.id === p.id)).map((p) => ({ ...p, former: true })),
  ]

  function openWith(next: boolean) {
    if (next) setSelected(currentIds)
    setOpen(next)
  }

  function save() {
    setOpen(false)
    onAssign(selected.map((id) => choices.find((c) => c.id === id)!).map(({ id, name }) => ({ id, name })))
  }

  const empty = current.length === 0
  const triggerClass = empty
    ? cn(
        "touch-hit inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border border-destructive/40 bg-destructive/[0.06] px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 data-[popup-open]:bg-destructive/10",
        className,
      )
    : cn("touch-hit inline-flex shrink-0 items-center rounded-full px-0.5 transition-colors hover:bg-muted data-[popup-open]:bg-muted", className)
  const label = empty ? `${taskName} 담당 지정` : `${taskName} 담당 바꾸기 — 지금 ${current.map((p) => p.name).join(", ")}`
  const trigger = empty ? "담당 지정" : <AssigneeStack people={current} size="sm" />

  const body = (
    <>
      <AssigneeChips choices={choices} selected={selected} onToggle={(id) => setSelected((s) => toggleAssignee(s, id))} />
      <div className="mt-3 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
          {selected.length === 0 ? "한 명 이상 골라 주세요" : `${selected.length}명`}
        </span>
        <Button size="sm" variant="ghost" className="h-11 md:h-8" onClick={() => setOpen(false)}>
          취소
        </Button>
        <Button size="sm" data-quick-assign-save className="h-11 min-w-20 md:h-8" disabled={!canSaveAssignees(currentIds, selected)} onClick={save}>
          저장
        </Button>
      </div>
    </>
  )

  if (!isMobile) {
    return (
      <Popover open={open} onOpenChange={openWith}>
        <PopoverTrigger data-quick-assign-chip={taskId} aria-label={label} className={triggerClass}>
          {trigger}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-2 p-3" data-quick-assign-pop={taskId}>
          <p className="text-xs text-muted-foreground">여러 명을 고를 수 있어요 · 새로 지정된 사람에게만 알림이 갑니다</p>
          {body}
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <button type="button" data-quick-assign-chip={taskId} aria-label={label} className={triggerClass} onClick={() => openWith(true)}>
        {trigger}
      </button>
      <Drawer open={open} onOpenChange={openWith} repositionInputs={false}>
        <DrawerContent
          data-quick-assign-sheet={taskId}
          overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-none"
          className="pb-[calc(var(--safe-bottom)+16px)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
        >
          <div className="flex flex-col gap-1 px-4 pb-3 pt-4">
            <DrawerTitle className="line-clamp-2 text-[15px] font-semibold">{taskName}</DrawerTitle>
            <DrawerDescription className="text-xs">여러 명을 고를 수 있어요 · 새로 지정된 사람에게만 알림이 갑니다</DrawerDescription>
          </div>
          <div className="px-4">{body}</div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
