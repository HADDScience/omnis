"use client"

import { useEffect, useRef } from "react"

/**
 * 탭이 보일 때만 `callback` 을 `ms` 마다 부른다. 탭으로 돌아오면 한 번 바로 부르고 다시 센다.
 *
 * 폴링이 탭을 켜 둔 채 퇴근해도 밤새 돌았다 — 알림 2.5초 · 채팅 3초 폴링이 버셀 무료 요청 한도(월 100만)를
 * 채운 원인 중 하나였다(2026-09-15 운영 로그: 알림 폴링이 요청의 33%). 안 보이는 탭은 새 소식을 보여 줄 곳이 없다.
 */
export function useVisibleInterval(callback: () => void, ms: number, enabled = true) {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => saved.current(), ms)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        saved.current()
        start()
      } else {
        stop()
      }
    }
    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [ms, enabled])
}
