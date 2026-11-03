"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { saveShortcuts, useShortcutMap } from "@/hooks/use-shortcuts"
import {
  comboFromEvent,
  DEFAULT_SHORTCUTS,
  formatCombo,
  shortcutProblem,
  SHORTCUTS,
  type ShortcutAction,
} from "@/lib/shortcuts"

const subscribeNothing = () => () => {}
const isMacClient = () => /Mac|iPhone|iPad/.test(navigator.platform)
const isMacServer = () => true

/**
 * 키보드 단축키 — 키를 바꾸고 이 기기에 저장한다. 물리 키보드가 없는 폰에는 보이지 않는다.
 * 「변경」 을 누르고 키를 누르면 바로 판정한다 — 쓸 수 있으면 저장, 아니면 이유를 보이고 기다린다. Esc 는 취소.
 */
export function KeyboardShortcuts() {
  const map = useShortcutMap()
  const mac = useSyncExternalStore(subscribeNothing, isMacClient, isMacServer)
  const [capturing, setCapturing] = useState<ShortcutAction | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!capturing) return
    const action = capturing
    function onKeyDown(e: KeyboardEvent) {
      // 고르는 동안에는 어떤 단축키도 동작하지 않는다 — 창이 먼저 받아 아래로 내려보내지 않는다
      e.preventDefault()
      e.stopPropagation()
      if (e.code === "Escape") {
        setCapturing(null)
        setProblem(null)
        return
      }
      if (e.repeat) return
      const combo = comboFromEvent(e)
      if (!combo) return
      const reason = shortcutProblem(combo, action, map)
      if (reason) {
        setProblem(reason)
        return
      }
      const saved = saveShortcuts({ ...map, [action]: combo })
      setCapturing(null)
      setProblem(null)
      setNotice(saved ? "저장했습니다" : "이 브라우저에 저장하지 못했습니다. 새로고침하면 원래 키로 돌아갑니다")
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [capturing, map])

  const isDefault = SHORTCUTS.every((s) => map[s.id] === DEFAULT_SHORTCUTS[s.id])

  return (
    <Card className="py-0 [@media(pointer:coarse)]:hidden" data-keyboard-shortcuts>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium">키보드 단축키</h2>
            <p className="text-[11.5px] text-muted-foreground">이 기기에만 저장합니다 · 조합키가 필요합니다</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={isDefault}
            onClick={() => {
              const saved = saveShortcuts({ ...DEFAULT_SHORTCUTS })
              setCapturing(null)
              setProblem(null)
              setNotice(saved ? "기본값으로 되돌렸습니다" : "이 브라우저에 저장하지 못했습니다")
            }}
          >
            기본값 복원
          </Button>
        </div>
        <ul className="flex flex-col divide-y">
          {SHORTCUTS.map((s) => {
            const active = capturing === s.id
            return (
              <li key={s.id} data-shortcut={s.id} className="px-3 py-2 text-[13px]">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    {s.label}
                    {!s.inInput && <span className="ml-1.5 text-[11.5px] text-muted-foreground">입력칸에서는 동작하지 않음</span>}
                  </span>
                  <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">
                    {active ? "키를 누르세요" : formatCombo(map[s.id], mac)}
                  </kbd>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${s.label} 키 ${active ? "변경 취소" : "변경"}`}
                    onClick={() => {
                      setCapturing(active ? null : s.id)
                      setProblem(null)
                      setNotice(null)
                    }}
                  >
                    {active ? "취소" : "변경"}
                  </Button>
                </div>
                {active && problem && (
                  <p role="alert" className="mt-1 text-[11.5px] text-destructive">
                    {problem}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
        {notice && (
          <p role="status" className="border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
            {notice}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
