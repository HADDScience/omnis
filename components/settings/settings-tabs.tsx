"use client"

import { useEffect, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"

import { Tabs } from "@/components/ui/tabs"
import { resolveSettingsTab, UI_METRICS_NOTICE_ANCHOR } from "@/lib/settings-tab"

/**
 * 마이 화면의 탭 — 고른 탭을 주소(`?tab=`)에 둔다. 알림 링크로 바로 열고, 새로고침해도 그 탭이다.
 *
 * 탭을 바꿀 때는 history 를 쌓지 않는다. 쌓으면 뒤로 가기가 탭만 되짚어 마이 화면을 떠나기 어렵다.
 */
export function SettingsTabs({ children }: { children: ReactNode }) {
  const tab = resolveSettingsTab(useSearchParams().get("tab"))

  // 수집 안내 링크(#…)로 왔으면 탭이 그려진 뒤 그 자리까지 내린다. 탭 줄이 화면 아래에 있어 안 내리면 안내가 보이지 않는다
  useEffect(() => {
    if (window.location.hash === `#${UI_METRICS_NOTICE_ANCHOR}`) {
      document.getElementById(UI_METRICS_NOTICE_ANCHOR)?.scrollIntoView({ block: "center" })
    }
  }, [tab])

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => window.history.replaceState(null, "", `${window.location.pathname}?tab=${next}`)}
    >
      {children}
    </Tabs>
  )
}
