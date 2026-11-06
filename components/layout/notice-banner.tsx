"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { apiUrl } from "@/lib/base-path"
import { BYPASS_FLAG_COOKIE } from "@/lib/maintenance/rules"
import type { MaintenanceState } from "@/lib/maintenance/state"

/** 화면이 보이고 사람이 쓰고 있을 때만 이 간격으로 묻는다. 늦어지는 최댓값 계산은 app/api/status/route.ts */
const POLL_MS = 25_000
/** 이만큼 입력이 없으면 묻기를 멈춘다 — 켜 둔 채 자리를 비운 PC 가 밤새 읽기 한도를 쓰지 않게 */
const IDLE_MS = 15 * 60_000
const DISMISS_KEY = "omnis_notice_dismissed"
const RELOAD_KEY = "omnis_maintenance_reloaded_at"
/** 새로고침이 아직 옛 화면을 받아도(서버 캐시 30초) 연달아 새로고침하지 않게 */
const RELOAD_GAP_MS = 30_000

/** 우회로 들어온 관리자인가 — proxy 가 우회 쿠키와 함께 심는 표식(lib/maintenance/rules.ts BYPASS_FLAG_COOKIE) */
function hasBypassFlag() {
  return document.cookie.split("; ").some((row) => row.startsWith(`${BYPASS_FLAG_COOKIE}=`))
}

/**
 * 점검이 켜졌는데 우회 표식이 없으면 새로고침한다 — proxy 가 점검 화면으로 돌리고, 열린 화면의
 * API 호출(채팅 3초 폴링 등)도 함께 멎는다. API 는 proxy 밖이라 이것이 열린 화면을 멈추는 길이다.
 */
function reloadIntoMaintenance() {
  if (hasBypassFlag()) return
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
    if (Date.now() - last < RELOAD_GAP_MS) return
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {}
  window.location.reload()
}

function noticeId(state: MaintenanceState) {
  return `${state.updatedAt ?? ""}|${state.message}`
}

function readDismissed(): string | null {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

/**
 * 점검 스위치의 공지 띠. banner 면 누구에게나, maintenance 면 우회로 들어온 관리자에게 보인다
 * (그 밖의 사람은 새로고침되어 proxy 의 점검 화면으로 간다). 띠의 높이는 TopBanners 가 재서 화면을 아래로 민다.
 */
export function NoticeBanner() {
  const [state, setState] = useState<MaintenanceState | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const lastActive = useRef(Date.now())
  // 늦게 온 옛 응답이 새 값을 덮지 않게 — 보낸 순서가 더 늦은 응답만 쓴다
  const sent = useRef(0)
  const applied = useRef(0)

  const check = useCallback(async () => {
    const seq = ++sent.current
    try {
      const res = await fetch(apiUrl("/api/status"), { cache: "no-store" })
      if (!res.ok) return
      const next = (await res.json()) as MaintenanceState
      if (seq < applied.current) return
      applied.current = seq
      setState(next)
      if (next.mode === "maintenance") reloadIntoMaintenance()
    } catch {
      // 묻지 못하면 띠를 그대로 둔다. 다음 차례에 다시 묻는다
    }
  }, [])

  useEffect(() => {
    setDismissed(readDismissed())
    void check()

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      if (Date.now() - lastActive.current > IDLE_MS) return
      void check()
    }, POLL_MS)

    const onActive = () => {
      const wasIdle = Date.now() - lastActive.current > IDLE_MS
      lastActive.current = Date.now()
      if (wasIdle) void check()
    }
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      lastActive.current = Date.now()
      void check()
    }
    window.addEventListener("pointerdown", onActive, { passive: true })
    window.addEventListener("keydown", onActive)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("pointerdown", onActive)
      window.removeEventListener("keydown", onActive)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [check])

  if (!state || state.mode === "off") return null
  const maintenance = state.mode === "maintenance"
  if (!maintenance && dismissed === noticeId(state)) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-notice-banner={state.mode}
      className={
        maintenance
          ? "flex items-center justify-center gap-2 bg-red-600 px-4 py-1.5 text-xs font-medium text-white sm:text-sm dark:bg-red-700"
          : "flex items-center justify-center gap-2 bg-amber-100 px-4 py-1.5 text-xs font-medium text-amber-950 sm:text-sm dark:bg-amber-900 dark:text-amber-50"
      }
    >
      <span className="min-w-0 break-keep text-center">
        {maintenance && <strong className="mr-1.5">점검 중 · 우회 접속</strong>}
        {state.message || (maintenance ? "" : "공지")}
      </span>
      {!maintenance && (
        <button
          type="button"
          onClick={() => {
            const id = noticeId(state)
            try {
              sessionStorage.setItem(DISMISS_KEY, id)
            } catch {}
            setDismissed(id)
          }}
          aria-label="공지 닫기"
          className="-my-1 shrink-0 rounded-full p-1.5 transition-colors hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current [@media(pointer:coarse)]:p-2.5"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={14} />
        </button>
      )}
    </div>
  )
}
