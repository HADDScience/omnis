/** 마이 화면의 탭. 주소의 `?tab=` 값이다. 시험: settings-tab.test.ts
 *  2026-11-11: 「알림 설정」 앞에 「일반」(테마 · 키보드 단축키)을 두고 첫 탭으로 삼았다 */
export const SETTINGS_TABS = ["general", "notify", "usage", "info"] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

/** 마이 탭을 셋으로 줄이기 전(2026-11-06)의 값 — 알림 · 북마크의 옛 링크가 같은 내용으로 열리게 */
const LEGACY_TABS: Record<string, SettingsTab> = { push: "notify", ai: "usage", system: "info" }
/** 연결된 계정 탭은 프로필 설정 화면으로 옮겼다 */
export const PROFILE_HREF = "/settings/profile"
export const LEGACY_PROFILE_TAB = "accounts"

/** 옛 자리 — 마이 > 앱 정보의 사용 기록 안내. 2026-11-11 개인정보 처리방침으로 옮겼다. 이 주소로 오면 새 자리로 보낸다 */
export const UI_METRICS_NOTICE_ANCHOR = "ui-metrics-notice"
/** 개인정보 처리방침 안의 사용 기록 안내 자리 */
export const UI_METRICS_PRIVACY_ANCHOR = "ui-metrics"
/** 수집 안내 알림의 「자세히」 */
export const UI_METRICS_NOTICE_HREF = `/privacy#${UI_METRICS_PRIVACY_ANCHOR}`

/** 모르는 값이나 없는 값이면 첫 탭. 옛 값은 새 탭으로 */
export function resolveSettingsTab(value: string | null | undefined): SettingsTab {
  if (value && Object.hasOwn(LEGACY_TABS, value)) return LEGACY_TABS[value]
  return SETTINGS_TABS.find((t) => t === value) ?? "general"
}

/** 옛 탭 값이면 바꿔 쓸 주소. 그대로 둬도 되면 null — 서버 페이지가 redirect 한다 */
export function legacySettingsRedirect(value: string | null | undefined): string | null {
  if (value === LEGACY_PROFILE_TAB) return PROFILE_HREF
  if (value && Object.hasOwn(LEGACY_TABS, value)) return `/settings?tab=${LEGACY_TABS[value]}`
  return null
}
