"use client"

import { useEffect } from "react"

import { apiUrl } from "@/lib/base-path"
import { PRESENCE_PING_MS } from "@/lib/notify-rules"
import { currentSubscription } from "@/lib/pwa"

/** 사람이 이 화면을 만졌다는 신호 — use-visible-interval 과 같은 묶음 */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const

/**
 * 「이 기기에서 쓰는 중」 을 서버에 알린다. 화면에 아무것도 그리지 않는다.
 * 서버는 최근에 신호를 보낸 기기로만 푸시를 보낸다 — PC 에서 쓰는 중에 폰이 울리지 않게
 * (mydocs/plans/2026-10-30-push-active-device.md).
 *
 * 타이머가 아니라 사람의 동작에 맞춰 보낸다. 만지지 않으면 요청이 없어 Neon 이 잠들 수 있다.
 */
export function PushPresence() {
  useEffect(() => {
    let last = 0

    const ping = () => {
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (now - last < PRESENCE_PING_MS) return
      last = now
      void (async () => {
        const endpoint = (await currentSubscription().catch(() => null))?.endpoint ?? null
        await fetch(apiUrl("/api/push/presence"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => {})
      })()
    }

    ping()
    document.addEventListener("visibilitychange", ping)
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, ping, { passive: true })
    return () => {
      document.removeEventListener("visibilitychange", ping)
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, ping)
    }
  }, [])

  return null
}
