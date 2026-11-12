/**
 * 사용 안내(스포트라이트 투어)의 판 번호.
 *
 * 화면이 크게 바뀌어 모두에게 안내를 다시 보여야 하면 이 숫자를 올린다. 사람마다 마지막으로 마치거나 건너뛴 판을
 * User.onboardingVersion 에 적고, 그 판이 지금 판보다 낮으면 다음 접속에 안내를 다시 띄운다.
 * 이력(onboardingCompletedAt — 처음 마친 시각)은 지우거나 덮어쓰지 않는다.
 *
 * 1 — 2026-10-29 스포트라이트 안내(판 칸이 생기기 전에 마친 사람은 이 판을 본 것으로 읽는다)
 * 2 — 2026-11-12 PC 대화 패널 · 방 서랍 · 답장 인용 · AI 활용 설문
 */
export const ONBOARDING_VERSION = 2

/**
 * 관리자가 「모두에게 온보딩 다시 띄우기」 로 올린 판(AppSetting) — 코드 · 배포 없이 다시 띄운다(2026-11-12).
 * 지금 판은 코드 상수와 이 값 중 큰 것이다. 코드 상수를 올려 배포하면 그쪽이 앞서고, 단추를 누르면 그다음 판이 된다
 */
export const ONBOARDING_VERSION_SETTING = "onboarding_version"

/** 지금 판 — 코드 상수와 저장된 값(정수가 아니면 무시) 중 큰 것 */
export function effectiveOnboardingVersion(stored: unknown, code = ONBOARDING_VERSION): number {
  const n = typeof stored === "number" ? stored : typeof stored === "object" && stored !== null ? (stored as { version?: unknown }).version : null
  return typeof n === "number" && Number.isSafeInteger(n) && n > code ? n : code
}

export interface OnboardingSeen {
  onboardingCompletedAt: Date | string | null
  onboardingVersion: number | null
}

/** 이 사람이 본 판. 판 칸이 비어 있으면 마친 시각으로 짐작한다(칸이 생기기 전 기록) */
export function seenOnboardingVersion(user: OnboardingSeen): number {
  if (user.onboardingVersion != null) return user.onboardingVersion
  return user.onboardingCompletedAt ? 1 : 0
}

/** 안내를 다시 띄울까 */
export function needsOnboarding(user: OnboardingSeen, current = ONBOARDING_VERSION): boolean {
  return seenOnboardingVersion(user) < current
}
