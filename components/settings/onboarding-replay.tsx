"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
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
import { apiUrl } from "@/lib/base-path"

/**
 * 「모두에게 온보딩 다시 띄우기」 — 관리자만. 누르면 확인 대화에 몇 명에게 다시 뜨는지 보이고(그 순간 다시 센다),
 * 확인하면 판을 하나 올린다(app/api/onboarding/replay). 다음 화면부터 바로 뜬다 — 나도 포함이다
 */
export function OnboardingReplay({ version }: { version: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [due, setDue] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  async function ask() {
    setDue(null)
    setOpen(true)
    const res = await fetch(apiUrl("/api/onboarding/replay"), { cache: "no-store" }).catch(() => null)
    if (!res?.ok) {
      setOpen(false)
      return void toast.error("인원을 세지 못했습니다. 잠시 뒤 다시 눌러 주세요")
    }
    setDue(((await res.json()) as { due: number }).due)
  }

  async function replay() {
    setBusy(true)
    const res = await fetch(apiUrl("/api/onboarding/replay"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: version }),
    }).catch(() => null)
    setBusy(false)
    setOpen(false)
    if (!res?.ok) {
      const message = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null
      return void toast.error(message ?? "다시 띄우지 못했습니다")
    }
    const body = (await res.json()) as { version: number; due: number }
    toast.success(`${body.due}명에게 다음 접속 때 안내가 다시 뜹니다`)
    router.refresh()
  }

  return (
    <>
      <Button type="button" variant="outline" data-onboarding-replay onClick={ask} className="touch-target self-start">
        모두에게 온보딩 다시 띄우기
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <AlertDialogContent data-onboarding-replay-confirm>
          <AlertDialogHeader>
            <AlertDialogTitle>모두에게 온보딩을 다시 띄울까요?</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-1.5">
              <span data-onboarding-replay-due className="font-medium text-foreground">
                {due === null ? "인원을 세는 중…" : `활성 사용자 ${due}명에게 다음 접속 때 안내가 뜹니다.`}
              </span>
              <span>안내를 마치거나 건너뛰면 다시 뜨지 않습니다. 누가 언제 눌렀는지 기록이 남습니다.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="touch-target">취소</AlertDialogCancel>
            <AlertDialogAction className="touch-target" onClick={replay} disabled={busy || due === null}>
              다시 띄우기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
