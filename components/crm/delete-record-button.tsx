"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Delete02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

/**
 * 지우기.
 *
 * 무엇이 함께 사라지고 무엇이 남는지를 누르기 전에 말한다. "정말 삭제하시겠습니까?"
 * 만 묻는 창은 사람이 판단할 재료를 주지 않는다 — 금액이 얼마짜리인지, 딸린 출고가
 * 있는지 모르는 채로 예를 누르게 된다.
 *
 * native confirm 은 쓰지 않는다 (규칙 11).
 */
export function DeleteRecordButton({
  endpoint,
  redirectTo,
  title,
  code,
  /** 함께 사라지는 것 · 남는 것을 사람 말로 적는다 */
  consequences,
  onDeleted,
}: {
  endpoint: string
  /** 지운 뒤 갈 곳. 이미 그 목록에 있으면 onDeleted 를 주고 이걸 비운다. */
  redirectTo?: string
  title: string
  code: string
  consequences: string[]
  /**
   * 목록 안에서 지울 때 쓴다. 목록이 자기 상태를 들고 있으면 서버가 지워도
   * 화면에는 그대로 남는다 — router.refresh 는 서버 자료만 새로 읽지, 클라이언트
   * state 를 되돌리지 않는다.
   */
  onDeleted?: () => void
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: "DELETE" })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "지우지 못했습니다")
        toast.success(`${code} 을 지웠어요`)
        onDeleted?.()
        if (redirectTo) router.push(redirectTo)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive" />
        }
      >
        <HugeiconsIcon icon={Delete02Icon} size={14} aria-hidden />
        지우기
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono">{code}</span> 을 지웁니다. 되돌릴 수 없어요.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1 text-[13px] text-muted-foreground">
          {consequences.map((c) => (
            <li key={c} className="flex gap-1.5">
              <span aria-hidden>·</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>그만두기</AlertDialogCancel>
          <AlertDialogAction
            onClick={remove}
            disabled={pending}
            className="gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            {pending && <Spinner />}
            지우기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
