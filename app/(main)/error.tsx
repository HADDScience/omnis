"use client"

import { useEffect } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Refresh01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { reportClientError } from "@/lib/report-client-error"
import { isChunkLoadError } from "@/lib/nav-rescue"

/**
 * 화면 한 곳이 터져도 사이드바와 나머지는 살아 있게 한다.
 * 이게 없으면 Next.js 가 "Application error: a client-side exception has
 * occurred" 흰 화면만 보여 주고, 무슨 일이 났는지 아무도 모른다.
 */
export default function MainError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error, "page")
  }, [error])

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-[420px] rounded-xl border bg-card p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
          <HugeiconsIcon icon={Alert02Icon} size={20} aria-hidden />
        </div>
        <h1 className="text-[16px] font-bold">이 화면을 여는 중 문제가 생겼어요</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          담당자에게 자동으로 알렸습니다. 다시 시도하거나 다른 화면으로 이동해 주세요.
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            오류 번호 {error.digest}
          </p>
        )}
        <div className="mt-5 flex justify-center gap-2">
          {/* JS 조각을 못 받아 터졌으면(ChunkLoadError — 오프라인 중 아카이브) reset() 은 그 조각을 다시 받지 않는다. 문서를 새로 연다 */}
          <Button
            onClick={() => (isChunkLoadError(error) ? window.location.reload() : reset())}
            className="gap-1.5"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={15} aria-hidden />
            다시 시도
          </Button>
          <Button variant="outline" render={<Link href="/tasks" />}>
            업무로
          </Button>
        </div>
      </div>
    </div>
  )
}
