"use client"

import { useEffect, useState } from "react"
import { distanceFromBottom } from "@/lib/agent/scroll-follow"
import { isKeyboardOpen, isTextEntry, rememberBaseline, TOUCH_SCREEN_QUERY } from "@/lib/keyboard-viewport"

/** 키보드가 가리지 않는 높이로 맞춘 동안의 값. 셸과 nav 여백이 이 변수로 높이를 잰다 */
const DOCK_VARS = ["--app-vh", "--nav-offset-bottom", "--safe-bottom"] as const

/** 칸 높이가 바뀌는 동안 맨 아래까지 남은 거리를 지킨다 — 입력창 바로 위에 보이던 글이 그 자리에 남는다 */
function keepingBottom(change: () => void) {
  const lists = Array.from(document.querySelectorAll<HTMLElement>("[data-keep-bottom]"))
  const distances = lists.map(distanceFromBottom)
  change()
  lists.forEach((el, i) => {
    el.scrollTop = el.scrollHeight - el.clientHeight - distances[i]
  })
}

/**
 * 화면 키보드가 열렸는가(폰 · 태블릿). 앱 셸에서 한 번만 쓴다.
 *
 * 포커스가 메신저 입력창(`[data-composer]`)이나 채팅 검색 줄(`[data-keyboard-dock]`)에 있으면 입력창을 키보드 바로 위에 붙인다 — 셸을 보이는 높이로 줄이고,
 * nav 자리와 홈 인디케이터 여백을 걷는다. 다른 입력 칸은 브라우저가 칸을 찾아 올려 주는 동작을 그대로 둔다.
 */
export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const touch = window.matchMedia(TOUCH_SCREEN_QUERY)
    const baselines = new Map<number, number>()
    let dockedHeight: number | null = null
    let focusTimer: ReturnType<typeof setTimeout> | undefined

    const dock = (height: number | null) => {
      if (height === dockedHeight) return
      dockedHeight = height
      keepingBottom(() => {
        if (height === null) {
          root.removeAttribute("data-keyboard-docked")
          for (const name of DOCK_VARS) root.style.removeProperty(name)
        } else {
          root.setAttribute("data-keyboard-docked", "")
          // 안드로이드 태블릿은 md 이상이라 html zoom 이 걸려 있다 — 평소 --app-vh 처럼 배율을 나눈다
          root.style.setProperty("--app-vh", `calc(${height}px / var(--ui-zoom))`)
          root.style.setProperty("--nav-offset-bottom", "0px")
          // 키보드가 홈 인디케이터를 덮는다. 그 여백을 남기면 입력창과 키보드 사이가 뜬다
          root.style.setProperty("--safe-bottom", "0px")
        }
      })
    }

    const sync = () => {
      // 손가락으로 확대하면 vv.height 가 줄어든다 — 배율을 곱해 키보드로 착각하지 않는다
      const height = vv.height * vv.scale
      const width = Math.round(vv.width * vv.scale)
      const active = document.activeElement as HTMLElement | null
      const next = isKeyboardOpen({
        touch: touch.matches,
        textEntryFocused: isTextEntry(active as HTMLInputElement | null),
        baseline: rememberBaseline(baselines, width, Math.max(height, window.innerHeight)),
        height,
      })
      setOpen(next)
      dock(next && active?.closest("[data-composer],[data-keyboard-dock]") ? Math.round(vv.height) : null)
      // iOS 는 키보드가 열리면 입력칸을 찾아 화면을 위로 민다. 이미 보이는 높이로 줄였으니 되돌린다
      if (dockedHeight !== null && (window.scrollY !== 0 || vv.offsetTop !== 0)) window.scrollTo(0, 0)
    }

    // 칸을 옮길 때는 포커스가 잠깐 비었다 다음 칸으로 간다 — 그 사이에 nav 가 깜박이지 않게 다음 차례에 본다
    const syncAfterFocus = () => {
      clearTimeout(focusTimer)
      focusTimer = setTimeout(sync, 0)
    }

    sync()
    vv.addEventListener("resize", sync)
    vv.addEventListener("scroll", sync)
    window.addEventListener("focusin", syncAfterFocus)
    window.addEventListener("focusout", syncAfterFocus)
    return () => {
      clearTimeout(focusTimer)
      vv.removeEventListener("resize", sync)
      vv.removeEventListener("scroll", sync)
      window.removeEventListener("focusin", syncAfterFocus)
      window.removeEventListener("focusout", syncAfterFocus)
      dock(null)
    }
  }, [])

  return open
}
