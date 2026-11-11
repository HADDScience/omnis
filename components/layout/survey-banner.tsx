"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { SURVEY_BANNER_COOKIE, SURVEY_BANNER_DAYS, SURVEY_CHANGED_EVENT } from "@/lib/ai-survey/entry"

const dismissed = () => typeof document !== "undefined" && document.cookie.split("; ").some((row) => row.startsWith(`${SURVEY_BANNER_COOKIE}=1`))

function dismiss() {
  const expires = new Date()
  expires.setDate(expires.getDate() + SURVEY_BANNER_DAYS)
  document.cookie = `${SURVEY_BANNER_COOKIE}=1; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
}

/** 로그인 전 화면 · 설문 화면 자체에는 띄우지 않는다 */
const hiddenOn = (path: string) => path === "/" || path.startsWith("/login") || path.startsWith("/landing") || path.startsWith("/account") || path.startsWith("/sso") || path.startsWith("/settings/ai-survey")

/**
 * AI 활용 설문 안내 띠 — 옴니스에 들어오면 맨 위에. 설문이 열린 계정(AI_SURVEY_ALLOW_USER_IDS)이고
 * 한 번도 제출하지 않은 사람에게만 보인다(서버가 정한다). 닫으면 이 기기에서 7일 동안 숨긴다.
 * 높이 · 고정은 TopBanners 가 맡는다.
 */
export function SurveyBanner() {
  const path = usePathname() ?? "/"
  const inside = !hiddenOn(path)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!inside || dismissed()) {
      setShow(false)
      return
    }
    let alive = true
    const ask = () =>
      fetch("/api/ai-survey/banner")
        .then((r) => (r.ok ? (r.json() as Promise<{ show: boolean }>) : { show: false }))
        .then((r) => alive && setShow(r.show && !dismissed()))
        .catch(() => alive && setShow(false))
    void ask()
    // 설문을 제출하면 바로 걷는다
    window.addEventListener(SURVEY_CHANGED_EVENT, ask)
    return () => {
      alive = false
      window.removeEventListener(SURVEY_CHANGED_EVENT, ask)
    }
    // 로그인 화면에서 안으로 들어온 순간에 다시 묻는다 — 맨 위 띠는 화면을 옮겨도 그대로 남는 자리다
  }, [inside])

  if (!inside || !show) return null

  return (
    <div data-survey-banner role="status" aria-label="AI 활용 설문 안내" className="flex items-center justify-center gap-x-3 gap-y-0.5 border-b bg-primary/10 px-4 py-1.5 text-xs font-medium text-foreground sm:text-sm">
      <span className="min-w-0 break-keep">AI 를 어떻게 쓰고 계신지 알려 주세요 — 2~3분이면 끝나요.</span>
      <Link href="/settings/ai-survey" className="touch-hit shrink-0 font-semibold text-primary underline underline-offset-4">
        설문 참여하기
      </Link>
      <button
        type="button"
        onClick={() => {
          dismiss()
          setShow(false)
        }}
        aria-label="설문 안내 닫기 — 7일 동안 보지 않기"
        className="touch-hit ml-1 shrink-0 rounded-full p-1 transition-colors hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  )
}
