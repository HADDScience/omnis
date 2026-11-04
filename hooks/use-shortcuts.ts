"use client"

import { useEffect, useRef, useSyncExternalStore } from "react"
import {
  DEFAULT_SHORTCUTS,
  matchesCombo,
  sanitizeShortcuts,
  SHORTCUTS,
  type ShortcutAction,
  type ShortcutMap,
} from "@/lib/shortcuts"
import { trackUi } from "@/lib/ui-metrics/client"

// 단축키는 이 기기의 설정이다 — 테마처럼 localStorage 에 둔다. 맥과 윈도우에서 손에 맞는 키가 달라 DB 에 두지 않는다.
const STORAGE_KEY = "omnis:shortcuts:v1"

let current: ShortcutMap = DEFAULT_SHORTCUTS
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) current = sanitizeShortcuts(JSON.parse(raw))
  } catch {
    // 저장소를 못 읽으면(사생활 보호 모드 · 깨진 값) 기본 키로 쓴다
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // 다른 탭에서 바꾼 키도 이 탭에 바로 적용한다
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    loaded = false
    current = DEFAULT_SHORTCUTS
    load()
    listeners.forEach((l) => l())
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

function getSnapshot() {
  load()
  return current
}

const getServerSnapshot = () => DEFAULT_SHORTCUTS

/** 저장하고 바로 적용한다. 저장소에 쓰지 못하면 false — 이 탭에서는 적용되지만 다시 열면 사라진다 */
export function saveShortcuts(next: ShortcutMap): boolean {
  current = next
  listeners.forEach((l) => l())
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

export function useShortcutMap(): ShortcutMap {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}

/** 단축키 하나를 듣는다. 입력칸에서 받을지는 lib/shortcuts.ts 의 항목이 정한다 */
export function useShortcut(action: ShortcutAction, handler: () => void) {
  const combo = useShortcutMap()[action]
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  useEffect(() => {
    const inInput = SHORTCUTS.find((s) => s.id === action)?.inInput ?? false
    function onKeyDown(e: KeyboardEvent) {
      if (e.repeat || e.isComposing) return
      if (!matchesCombo(e, combo)) return
      if (!inInput && isTypingTarget(e.target)) return
      e.preventDefault()
      trackUi(`shortcut.${action}`)
      latest.current()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [action, combo])
}
