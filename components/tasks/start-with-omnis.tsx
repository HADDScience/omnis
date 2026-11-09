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
import { buildTaskStartPrompt, queueTaskStart, TASK_START_PARAM, type TaskStartInput } from "@/lib/task-start"
import { cn } from "@/lib/utils"

/**
 * 업무 상세의 「Omnis 와 함께 업무 시작하기」(2026-11-09).
 *
 * 누르면 확인 한 번 → 옴니스 **새 대화**가 열리고 이 업무를 진행하자는 첫 글이 저절로 들어가 보내진다(lib/task-start.ts).
 *   - PC(md 이상): 업무 화면(업무 탭)에 그대로 있고 오른쪽 패널의 「옴니스」 탭이 새 대화로 열린다
 *   - 폰: 패널이 없어 옴니스 새 대화 화면(/chat/new)으로 간다. 뒤로 가면 이 업무다
 * 같은 확인을 두 번 눌러도 한 번만 넘긴다(누른 순간 막고, 넘긴 키는 받는 쪽이 한 번만 쓴다).
 */
export function StartWithOmnis({ task, className }: { task: TaskStartInput; className?: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const firing = useRef(false)
  const router = useRouter()
  const { startOmnis } = useRightPanel()

  function start() {
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
      // 업무 화면에 남으므로 단추는 다시 쓸 수 있다. 같은 확인 창의 두 번째 누름은 막고(firing), 창을 새로 열 때 푼다
      setBusy(false)
    } else {
      router.push(`/chat/new?${TASK_START_PARAM}=${encodeURIComponent(key)}`)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        data-start-with-omnis
        onClick={() => {
          firing.current = false
          setOpen(true)
        }}
        disabled={busy}
        className={cn("touch-target h-10 w-full gap-2 border-primary/30 text-primary hover:bg-primary/5 hover:text-primary", className)}
      >
        <HugeiconsIcon icon={AiMagicIcon} size={16} aria-hidden />
        Omnis 와 함께 업무 시작하기
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent data-start-with-omnis-confirm>
          <AlertDialogHeader>
            <AlertDialogTitle>이 업무를 옴니스와 시작할까요?</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground">{task.name}</span>
              <span>옴니스 새 대화가 열리고, 남은 체크리스트를 기준으로 다음 할 일을 묻는 글이 바로 보내집니다.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
            <AlertDialogAction className="touch-target" onClick={start} disabled={busy}>
              시작하기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
