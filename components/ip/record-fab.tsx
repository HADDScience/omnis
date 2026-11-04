"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon } from "@hugeicons/core-free-icons"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ip/ip-dialog"
import { Button } from "@/components/ui/button"
import { ProgressForm } from "@/components/ip/progress-form"
import { useAuth } from "@/components/ip/auth-gate"

/**
 * 기록하기 — 어느 화면에서든 제목줄 버튼으로 연다.
 *
 * ip-platform 에서는 오른쪽 아래 떠 있는 버튼이었다. 옴니스에서는 그 사분면을 대화
 * 패널 단추가 쓰므로(ux-rules 14) 제목줄로 올렸다. 창과 양식은 그대로다.
 *
 * 기록은 다른 화면을 보다가 떠오르는 일이라 탭으로 옮겨 가게 두면 보던 자리를
 * 잃는다. 그래서 양식만 창으로 띄운다. 최근 기록 목록·수정·삭제는 /record 에 남아
 * 있고 창 안의 링크로 간다.
 */
export function RecordButton() {
  const pathname = usePathname()
  const { canWrite } = useAuth()
  const [open, setOpen] = useState(false)
  // 저장할 때마다 양식을 새로 마운트해 빈 칸으로 되돌린다.
  const [round, setRound] = useState(0)

  const onRecordPage = /^\/ip\/record\/?$/.test(pathname)
  if (!canWrite || onRecordPage) return null

  return (
    <>
      <Button size="sm" className="touch-target" onClick={() => setOpen(true)} aria-label="기록하기">
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2.2} />
        <span className="hidden sm:inline">기록하기</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[44rem]">
          <DialogHeader className="pr-10">
            <DialogTitle>기록하기</DialogTitle>
            <DialogDescription>
              언제 · 어느 건이 · 어디까지 갔고 · 이제 누구 차례인지. IP 현황은
              이 기록에서 자동으로 갱신됩니다.{" "}
              <Link
                href="/ip/record"
                onClick={() => setOpen(false)}
                className="text-primary hover:underline"
              >
                최근 기록 보기
              </Link>
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <ProgressForm
              key={round}
              onSaved={() => {
                setRound((r) => r + 1)
                setOpen(false)
              }}
              onCancel={() => setOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
