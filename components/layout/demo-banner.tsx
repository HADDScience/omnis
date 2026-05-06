"use client"

import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true"
const COOKIE_NAME = "omnis_demo_banner_dismissed"
const COOKIE_DAYS = 7

function readDismissCookie() {
  if (typeof document === "undefined") return false
  return document.cookie
    .split("; ")
    .some((row) => row.startsWith(`${COOKIE_NAME}=1`))
}

function writeDismissCookie() {
  if (typeof document === "undefined") return
  const expires = new Date()
  expires.setDate(expires.getDate() + COOKIE_DAYS)
  document.cookie = `${COOKIE_NAME}=1; expires=${expires.toUTCString()}; path=/; SameSite=Lax`
}

export function DemoBanner() {
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(readDismissCookie())
  }, [])

  if (!IS_DEMO || dismissed) return null

  return (
    <div
      role="status"
      aria-label="시연용 데모 사이트 안내"
      className="sticky top-0 flex items-center justify-center gap-3 border-b border-blue-400/40 bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm sm:text-sm dark:border-blue-300/30 dark:bg-blue-700"
      style={{ zIndex: "var(--z-banner)" }}
    >
      <span aria-hidden className="text-base leading-none">🚀</span>
      <span>시연용 데모 사이트 — 모든 데이터는 익명 더미입니다.</span>
      <a
        href="https://github.com/HADDScience/omnis"
        target="_blank"
        rel="noopener noreferrer"
        className="underline-offset-2 hover:underline"
      >
        소스 보기
      </a>
      <button
        type="button"
        onClick={() => {
          writeDismissCookie()
          setDismissed(true)
        }}
        aria-label="배너 닫기"
        className="ml-2 rounded-full p-1 transition-colors hover:bg-blue-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} />
      </button>
    </div>
  )
}
