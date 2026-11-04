/** 마이 화면의 탭. 주소의 `?tab=` 값이다. 시험: settings-tab.test.ts */
export const SETTINGS_TABS = ["push", "accounts", "ai", "system"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

export const UI_METRICS_NOTICE_ANCHOR = "ui-metrics-notice"
/** 수집 안내 알림의 「자세히」 */
export const UI_METRICS_NOTICE_HREF = `/settings?tab=system#${UI_METRICS_NOTICE_ANCHOR}`

/** 모르는 값이나 없는 값이면 첫 탭 */
export function resolveSettingsTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.find((t) => t === value) ?? "push"
}
