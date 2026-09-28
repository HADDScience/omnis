"use client"

import { useEffect, useRef } from "react"

/** 사람이 여기 있다는 신호. 마우스가 움직이지 않는 두 번째 모니터에서는 하나도 오지 않는다. */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const

/**
 * 이 시간 동안 아무 신호가 없으면 사람이 없다고 본다.
 *
 * 5분이 아니라 10분인 이유: Neon 은 마지막 질의로부터 **5분** 뒤에 잠든다. 유휴 판정이
 * 5분이면 잠들락 말락 하는 경계에 걸려, 깨어 있는 시간은 그대로인데 화면만 늦어진다.
 */
const IDLE_MS = 10 * 60_000

/**
 * 탭이 보이고 **사람이 있을 때만** `callback` 을 `ms` 마다 부른다.
 *
 * 두 겹으로 멈춘다.
 *
 * 1. **안 보이는 탭** — 새 소식을 보여 줄 곳이 없다. 돌아오면 바로 한 번 부르고 다시 센다.
 * 2. **보이지만 사람이 없는 탭** — 켜 두고 퇴근한 화면이다. 마우스·키보드가 10분간 조용하면
 *    멈추고, 다시 만지면 그 자리에서 한 번 부르고 재개한다.
 *
 * 2번이 필요한 이유는 요청 수가 아니라 **DB 요금**이다. Neon 은 마지막 질의 5분 뒤에 자는데,
 * 채팅 3초·알림 15초 폴링은 탭이 하나만 열려 있어도 그 5분을 영원히 채운다 — 밤새 켜 둔
 * 탭 하나가 컴퓨트를 24시간 깨워 둔다. 2026-09-23 에 Neon 무료 한도(100 CU-시간/월)가
 * 터져 Omnis 와 홈페이지가 함께 멈춘 일이 있었다.
 *
 * 놓친 것은 재개할 때 따라잡는다 — 채팅은 `after` 커서로, 알림은 목록을 통째로 다시 읽는다.
 */
export function useVisibleInterval(
  callback: () => void,
  ms: number,
  enabled = true,
  idleMs: number = IDLE_MS
) {
  const saved = useRef(callback)
  useEffect(() => {
    saved.current = callback
  }, [callback])

  const lastActivity = useRef(Date.now())
  const idle = useRef(false)

  useEffect(() => {
    if (!enabled) return

    const wake = () => {
      lastActivity.current = Date.now()
      if (!idle.current) return
      // 멈춰 있었으면 다음 tick 을 기다리지 않는다 — 돌아온 사람이 낡은 화면을 보지 않게
      idle.current = false
      saved.current()
    }

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        if (Date.now() - lastActivity.current > idleMs) {
          // 타이머는 그대로 둔다. 네트워크만 쉰다 — 다시 붙이고 떼는 것보다 단순하다
          idle.current = true
          return
        }
        saved.current()
      }, ms)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        // 탭으로 돌아온 것 자체가 사람이 있다는 신호다
        lastActivity.current = Date.now()
        idle.current = false
        saved.current()
        start()
      } else {
        stop()
      }
    }

    if (document.visibilityState === "visible") start()
    document.addEventListener("visibilitychange", onVisibility)
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, wake, { passive: true })

    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, wake)
    }
  }, [ms, enabled, idleMs])
}
