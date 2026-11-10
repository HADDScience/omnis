"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { AiMagicIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useRightPanel } from "@/components/layout/right-panel-context"
import { NAV_DESKTOP_QUERY } from "@/components/layout/floating-nav"
import { apiUrl } from "@/lib/base-path"
import { buildTaskStartPrompt, queueTaskStart, TASK_START_PARAM, type TaskStartInput } from "@/lib/task-start"
import { cn } from "@/lib/utils"

/**
 * 「Omnis 와 함께 업무 시작하기」(2026-11-09) — 업무 상세의 단추(StartWithOmnis)와 업무 목록 · 보드의 아이콘(StartWithOmnisIcon).
 *
 * 누르면 확인 한 번 → 옴니스 **새 대화**가 열리고 이 업무를 진행하자는 첫 글이 저절로 들어가 보내진다(lib/task-start.ts).
 *   - PC(md 이상): 지금 화면(업무 탭)에 그대로 있고 오른쪽 패널의 「옴니스」 탭이 새 대화로 열린다
 *   - 폰: 패널이 없어 옴니스 새 대화 화면(/chat/new)으로 간다. 뒤로 가면 누른 화면이다
 * 같은 확인을 두 번 눌러도 한 번만 넘긴다(누른 순간 막고, 넘긴 키는 받는 쪽이 한 번만 쓴다).
 */
function useStartFlow() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const firing = useRef(false)
  const router = useRouter()
  const { startOmnis } = useRightPanel()

  function openConfirm() {
    firing.current = false
    setOpen(true)
  }

  function start(task: TaskStartInput) {
    if (firing.current) return
    firing.current = true
    setBusy(true)
    const key = queueTaskStart(task.id, buildTaskStartPrompt(task))
    if (!key) {
      toast.error("이 브라우저에서는 옴니스에 넘기지 못했어요. 옴니스 새 대화에서 #업무 로 불러 주세요")
      firing.current = false
      setBusy(false)
      return
    }
    setOpen(false)
    if (window.matchMedia(NAV_DESKTOP_QUERY).matches) {
      startOmnis(key)
      // 지금 화면에 남으므로 단추는 다시 쓸 수 있다. 같은 확인 창의 두 번째 누름은 막고(firing), 창을 새로 열 때 푼다
      setBusy(false)
    } else {
      router.push(`/chat/new?${TASK_START_PARAM}=${encodeURIComponent(key)}`)
    }
  }

  return { open, setOpen, busy, openConfirm, start }
}

function StartConfirm({
  open,
  onOpenChange,
  busy,
  taskName,
  ready,
  onStart,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy: boolean
  taskName: string
  /** 첫 글에 넣을 업무 내용을 다 받았나 — 목록은 창을 열 때 불러온다 */
  ready: boolean
  onStart: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <AlertDialogContent data-start-with-omnis-confirm>
        <AlertDialogHeader>
          <AlertDialogTitle>이 업무를 옴니스와 시작할까요?</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground">{taskName}</span>
            <span>옴니스 새 대화가 열리고, 남은 체크리스트를 기준으로 다음 할 일을 묻는 글이 바로 보내집니다.</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
          <AlertDialogAction className="touch-target" onClick={onStart} disabled={busy || !ready}>
            {ready ? "시작하기" : "불러오는 중…"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 업무 상세 위쪽의 단추 — 업무 내용을 이미 들고 있다 */
export function StartWithOmnis({ task, className }: { task: TaskStartInput; className?: string }) {
  const flow = useStartFlow()
  return (
    <>
      <Button
        type="button"
        variant="outline"
        data-start-with-omnis
        onClick={flow.openConfirm}
        disabled={flow.busy}
        className={cn("touch-target h-10 w-full gap-2 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary", className)}
      >
        <HugeiconsIcon icon={AiMagicIcon} size={16} aria-hidden />
        Omnis 와 함께 업무 시작하기
      </Button>
      <StartConfirm
        open={flow.open}
        onOpenChange={flow.setOpen}
        busy={flow.busy}
        taskName={task.name}
        ready
        onStart={() => flow.start(task)}
      />
    </>
  )
}

/**
 * 업무 목록 행 · 보드 카드의 아이콘(2026-11-10). 목록은 배경 · 체크리스트를 싣지 않아 확인 창을 열 때 그 한 장만 읽는다
 * (GET /api/tasks/[id]/start). 폰은 보이는 크기 그대로 44px 를 누를 수 있고, PC 는 28px.
 */
export function StartWithOmnisIcon({ taskId, taskName, className }: { taskId: string; taskName: string; className?: string }) {
  const flow = useStartFlow()
  const [loaded, setLoaded] = useState<TaskStartInput | null>(null)
  const loading = useRef(false)

  async function load() {
    if (loading.current) return
    loading.current = true
    try {
      const res = await fetch(apiUrl(`/api/tasks/${taskId}/start`))
      if (!res.ok) throw new Error(String(res.status))
      setLoaded((await res.json()) as TaskStartInput)
    } catch {
      flow.setOpen(false)
      toast.error("업무 내용을 불러오지 못했어요. 업무 상세에서 다시 시작해 주세요")
    } finally {
      loading.current = false
    }
  }

  return (
    <>
      <button
        type="button"
        data-start-with-omnis-icon={taskId}
        aria-label={`${taskName} — Omnis 와 시작`}
        title="Omnis 와 시작"
        disabled={flow.busy}
        onClick={() => {
          // 열 때마다 새로 읽는다 — 그사이 체크리스트가 바뀌었을 수 있다
          setLoaded(null)
          flow.openConfirm()
          void load()
        }}
        className={cn(
          "inline-flex size-[44px] shrink-0 items-center justify-center rounded-full text-primary transition-colors hover:bg-primary/10 active:bg-primary/15 disabled:opacity-50 md:size-7",
          className,
        )}
      >
        <HugeiconsIcon icon={AiMagicIcon} size={16} aria-hidden />
      </button>
      <StartConfirm
        open={flow.open}
        onOpenChange={flow.setOpen}
        busy={flow.busy}
        taskName={taskName}
        ready={loaded?.id === taskId}
        onStart={() => loaded && flow.start(loaded)}
      />
    </>
  )
}
