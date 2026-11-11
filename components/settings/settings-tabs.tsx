"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { Tabs } from "@/components/ui/tabs"
import { resolveSettingsTab, UI_METRICS_NOTICE_ANCHOR, UI_METRICS_NOTICE_HREF } from "@/lib/settings-tab"

/**
 * 마이 화면의 탭 — 고른 탭을 주소(`?tab=`)에 둔다. 알림 링크로 바로 열고, 새로고침해도 그 탭이다.
 *
 * 탭을 바꿀 때는 history 를 쌓지 않는다. 쌓으면 뒤로 가기가 탭만 되짚어 마이 화면을 떠나기 어렵다.
 */
export function SettingsTabs({ children }: { children: ReactNode }) {
  const tab = resolveSettingsTab(useSearchParams().get("tab"))
  const router = useRouter()

  // 사용 기록 안내는 개인정보 처리방침으로 옮겼다(2026-11-11) — 옛 「자세히」 링크(…#ui-metrics-notice)로 오면 새 자리로
  useEffect(() => {
    if (window.location.hash === `#${UI_METRICS_NOTICE_ANCHOR}`) router.replace(UI_METRICS_NOTICE_HREF)
  }, [router])

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => window.history.replaceState(null, "", `${window.location.pathname}?tab=${next}`)}
    >
      {children}
    </Tabs>
  )
}
