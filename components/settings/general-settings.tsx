"use client"

import { Fragment, useEffect, useState, useSyncExternalStore } from "react"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import { Moon01Icon, Sun01Icon } from "@hugeicons/core-free-icons"
import { Card, CardContent } from "@/components/ui/card"
import { KeyboardShortcuts } from "@/components/settings/keyboard-shortcuts"
import { FIXED_KEYS } from "@/lib/shortcuts"

const subscribeNothing = () => () => {}
const isMacClient = () => /Mac|iPhone|iPad/.test(navigator.platform)
const isMacServer = () => true

/**
 * 마이 > 일반(2026-11-11) — 테마와 키보드 단축키.
 * 단축키 두 카드(바꿀 수 있는 것 · 화면마다 정해진 것)는 키보드가 있는 기기에서만 보인다 —
 * 손가락이 주 입력인 폰 · 태블릿(pointer: coarse)에는 숨긴다(keyboard-shortcuts.tsx 와 같은 기준).
 */
export function GeneralSettings() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && theme === "dark"

  return (
    <div className="flex flex-col gap-4" data-general-settings>
      <Card className="py-0">
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setTheme(dark ? "light" : "dark")}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
          >
            <HugeiconsIcon icon={dark ? Sun01Icon : Moon01Icon} size={16} className="text-muted-foreground" aria-hidden />
            <span className="flex-1">테마</span>
            <span className="text-[11.5px] text-muted-foreground" suppressHydrationWarning>
              {mounted ? (dark ? "다크" : "라이트") : "—"}
            </span>
          </button>
        </CardContent>
      </Card>
      <KeyboardShortcuts />
      <FixedKeys />
    </div>
  )
}

/** 바꿀 수 없는 키 — lib/shortcuts.ts FIXED_KEYS */
function FixedKeys() {
  const mac = useSyncExternalStore(subscribeNothing, isMacClient, isMacServer)
  const label = (k: string) => (k === "Mod" ? (mac ? "⌘" : "Ctrl") : k === "Shift" && mac ? "⇧" : k)
  const groups = FIXED_KEYS.reduce<{ where: string; rows: (typeof FIXED_KEYS)[number][] }[]>((acc, k) => {
    const last = acc.at(-1)
    if (last?.where === k.where) last.rows.push(k)
    else acc.push({ where: k.where, rows: [k] })
    return acc
  }, [])

  return (
    <Card className="py-0 [@media(pointer:coarse)]:hidden" data-fixed-keys>
      <CardContent className="p-0">
        <div className="border-b px-3 py-2">
          <h2 className="text-[13px] font-medium">화면마다 정해진 키</h2>
          <p className="text-[11.5px] text-muted-foreground">바꿀 수 없습니다</p>
        </div>
        <dl className="grid grid-cols-[minmax(0,9rem)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-[12.5px]">
          {groups.map((g) => (
            <Fragment key={g.where}>
              {g.rows.map((r, i) => (
                <Fragment key={`${g.where}-${r.keys.join("+")}`}>
                  <dt className={i === 0 ? "font-medium" : "invisible"} aria-hidden={i !== 0}>
                    {g.where}
                  </dt>
                  <dd className="flex items-center gap-1 whitespace-nowrap">
                    {r.keys.map((k, j) => (
                      <Fragment key={k}>
                        {j > 0 && <span className="text-muted-foreground">{r.either ? "/" : "+"}</span>}
                        <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11.5px]">{label(k)}</kbd>
                      </Fragment>
                    ))}
                  </dd>
                  <dd className="text-muted-foreground">{r.what}</dd>
                </Fragment>
              ))}
            </Fragment>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
