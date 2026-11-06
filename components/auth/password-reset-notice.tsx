"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"

/** 「나중에」 는 이 탭이 열려 있는 동안만 — 다음에 앱을 열면 다시 권한다 */
const LATER_KEY = "omnis:password-reset-later"

/**
 * 관리자가 정해 준 비밀번호를 아직 쓰고 있을 때 띄우는 안내. 막지 않는다 —
 * 바꾸러 가거나 「나중에」 로 닫는다. 판단은 서버((main)/layout.tsx → lib/password-state.ts).
 */
export function PasswordResetNotice() {
  const { active: touring } = useOnboarding()
  const [hidden, setHidden] = useState(true)

  useEffect(() => {
    let later = false
    try {
      later = sessionStorage.getItem(LATER_KEY) === "1"
    } catch {}
    // 저장소를 읽은 뒤에야 보일지 정해진다 — 서버 렌더와 어긋나지 않게 효과 안에서 바꾼다
    setHidden(later)
  }, [])

  // 사용 안내가 화면을 덮는 동안은 띄우지 않는다 — 눌리지 않는 안내가 된다(app-nudge.tsx 와 같다)
  if (hidden || touring) return null

  function later() {
    try {
      sessionStorage.setItem(LATER_KEY, "1")
    } catch {}
    setHidden(true)
  }

  return (
    <div
      role="status"
      aria-label="비밀번호 변경 안내"
      className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 mx-auto flex max-w-xl flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-background px-4 py-3 text-[13px] shadow-lg"
    >
      <p className="min-w-0 flex-1 basis-56">
        관리자가 정해 준 임시 비밀번호를 쓰고 있습니다. 본인만 아는 비밀번호로 바꾸세요.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" onClick={later}>
          나중에
        </Button>
        <Link href="/account/password" className={buttonVariants({ size: "sm" })}>
          지금 바꾸기
        </Link>
      </div>
    </div>
  )
}
