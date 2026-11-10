"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"
import { apiUrl } from "@/lib/base-path"
import { pruneAssignOverrides, type AssignOverrides } from "@/lib/quick-assign"
import { cn } from "@/lib/utils"
import { QuickAssignChips } from "./quick-assign"

type Person = { id: string; name: string }

/**
 * 업무 목록 · 보드에서 담당 지정(2026-11-10). 업무 상세의 「담당자가 없어요」 칸(#178)과 같은 PATCH /api/tasks/[id] 의
 * assigneeIds — 권한 · 알림 · 이력은 그쪽(lib/task-update.ts)이 맡는다.
 * 고르면 화면을 먼저 바꾸고(덮어쓰기), 실패하면 되돌린다. 성공하면 서버 값을 다시 받아 덮어쓰기를 걷는다.
 */
export function useListQuickAssign() {
  const router = useRouter()
  const [overrides, setOverrides] = useState<AssignOverrides>({})

  const assign = useCallback(
    async (task: { id: string }, person: Person) => {
      setOverrides((o) => ({ ...o, [task.id]: person }))
      try {
        const res = await fetch(apiUrl(`/api/tasks/${task.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assigneeIds: [person.id] }),
        })
        if (!res.ok) throw new Error(`지정하지 못했습니다 (${res.status})`)
        toast.success(`${person.name}님을 담당으로 지정했어요`)
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

  const prune = useCallback((tasks: { id: string; unassigned?: boolean }[]) => {
    setOverrides((o) => pruneAssignOverrides(o, tasks))
  }, [])

  return { overrides, assign, prune }
}

/**
 * 담당 없는 업무 행 안의 작은 「담당 지정」 칩. 누르면 PC 는 팝오버, 폰은 바텀시트에 구성원 칩이 뜬다 — 한 번 누르면 끝.
 * 칩은 보이는 크기는 작게, 누르는 자리는 44px(touch-hit).
 */
export function QuickAssignChip({
  taskId,
  taskName,
  members,
  onAssign,
  className,
}: {
  taskId: string
  taskName: string
  members: Person[]
  onAssign: (person: Person) => void
  className?: string
}) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)

  function choose(person: Person) {
    setOpen(false)
    onAssign(person)
  }

  const chipClass = cn(
    "touch-hit inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border border-destructive/40 bg-destructive/[0.06] px-2 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10 data-[popup-open]:bg-destructive/10",
    className,
  )
  const label = `${taskName} 담당 지정`

  if (!isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger data-quick-assign-chip={taskId} aria-label={label} className={chipClass}>
          담당 지정
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-2 p-3" data-quick-assign-pop={taskId}>
          <p className="text-xs text-muted-foreground">누르면 바로 담당으로 지정되고 알림이 갑니다</p>
          <QuickAssignChips choices={members} pendingId={null} onAssign={choose} />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <>
      <button type="button" data-quick-assign-chip={taskId} aria-label={label} className={chipClass} onClick={() => setOpen(true)}>
        담당 지정
      </button>
      <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
        <DrawerContent
          data-quick-assign-sheet={taskId}
          overlayClassName="bg-black/40 supports-backdrop-filter:backdrop-blur-none"
          className="pb-[calc(var(--safe-bottom)+16px)] pl-[var(--safe-left)] pr-[var(--safe-right)]"
        >
          <div className="flex flex-col gap-1 px-4 pb-3 pt-4">
            <DrawerTitle className="line-clamp-2 text-[15px] font-semibold">{taskName}</DrawerTitle>
            <DrawerDescription className="text-xs">담당할 사람을 누르면 바로 지정되고 알림이 갑니다</DrawerDescription>
          </div>
          <div className="px-4">
            <QuickAssignChips choices={members} pendingId={null} onAssign={choose} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
