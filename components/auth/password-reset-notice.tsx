"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"

/** 「나중에」 는 이 탭이 열려 있는 동안만 — 다음에 앱을 열면 다시 권한다 */
const LATER_KEY = "omnis:password-reset-later"

/**
 * 관리자가 정해 준 비밀번호를 아직 쓰고 있을 때 띄우는 안내. 막지 않는다 —
 * 바꾸러 가거나 「나중에」 로 닫는다. 판단은 서버((main)/layout.tsx → lib/password-state.ts).
 *
 * 화면 아래에 뜨는 토스트다(위에 두면 폰에서 탭·제목줄을 덮었다 — 2026-11-06).
 * - 폰: 하단 nav 바로 위(`--nav-offset-bottom`, 홈 인디케이터 포함). PC: 오른쪽 아래.
 * - 입력창(`[data-room-composer-chrome]`)과 가로로 겹치면 그 위로 올린다 — 방 안 · PC 대화 패널.
 * - 떠 있는 동안 자기 높이를 `--notice-reserve` 로 내놓는다. 목록 끝 여백이 이 값을 더해 마지막 줄이 가리지 않는다.
 */
export function PasswordResetNotice() {
  const { active: touring } = useOnboarding()
  const [hidden, setHidden] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const [lift, setLift] = useState<number | null>(null)

  useEffect(() => {
    let later = false
    try {
      later = sessionStorage.getItem(LATER_KEY) === "1"
    } catch {}
    // 저장소를 읽은 뒤에야 보일지 정해진다 — 서버 렌더와 어긋나지 않게 효과 안에서 바꾼다
    setHidden(later)
  }, [])

  const shown = !hidden && !touring
  useEffect(() => {
    const el = box.current
    if (!shown || !el) return
    const root = document.documentElement
    let frame = 0
    const measure = () => {
      frame = 0
      const own = el.getBoundingClientRect()
      const composers = Array.from(document.querySelectorAll<HTMLElement>("[data-room-composer-chrome]"))
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.width > 0 && r.top < window.innerHeight && r.left < own.right && r.right > own.left)
      setLift(composers.length ? Math.max(0, window.innerHeight - Math.min(...composers.map((r) => r.top))) + 8 : null)
      root.style.setProperty("--notice-reserve", `${el.offsetHeight + 12}px`)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    // 방을 오가면 입력창이 생기고 사라진다 — 문서가 바뀔 때 다음 프레임에 한 번만 다시 잰다
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    const sizes = new ResizeObserver(schedule)
    sizes.observe(el)
    window.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("resize", schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      mutations.disconnect()
      sizes.disconnect()
      window.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
      root.style.removeProperty("--notice-reserve")
    }
  }, [shown])

  // 사용 안내가 화면을 덮는 동안은 띄우지 않는다 — 눌리지 않는 안내가 된다(app-nudge.tsx 와 같다)
  if (!shown) return null

  function later() {
    try {
      sessionStorage.setItem(LATER_KEY, "1")
    } catch {}
    setHidden(true)
  }

  return (
    <div
      ref={box}
      role="status"
      aria-label="비밀번호 변경 안내"
      style={lift === null ? undefined : { bottom: lift }}
      className="fixed inset-x-3 bottom-[calc(var(--nav-offset-bottom)+12px)] z-[45] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-popover px-4 py-3 text-[13px] text-popover-foreground shadow-xl md:inset-x-auto md:right-6 md:bottom-[calc(var(--nav-offset-bottom)+1.5rem)] md:w-[min(30rem,calc(100vw-3rem))]"
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
