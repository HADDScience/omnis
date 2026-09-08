import * as React from "react"

/**
 * matchMedia 구독 훅.
 *
 * 폴더블(Z Fold·Z Flip)은 앱이 떠 있는 상태에서 화면을 펼치면 뷰포트가 바뀐다.
 * 그래서 마운트 시 1회 측정이 아니라 change 이벤트를 구독해야 한다.
 * SSR 에서는 false 로 시작하고 hydration 직후 실제 값으로 맞춘다.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener("change", onChange)
      return () => mql.removeEventListener("change", onChange)
    },
    [query]
  )

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

/**
 * 뷰포트 계층 (CSS px 실측 기준)
 *
 * | tier       | 폭        | 대표 기기                                   |
 * |------------|-----------|--------------------------------------------|
 * | `compact`  | < 672     | Z Fold 접힘(320) · Z Flip 펼침(360) · 일반 폰 |
 * | `medium`   | 672~1023  | Z Fold 펼침(673) · 태블릿 세로               |
 * | `expanded` | ≥ 1024    | 태블릿 가로 · 데스크톱                       |
 */
export type ViewportTier = "compact" | "medium" | "expanded"

export function useViewportTier(): ViewportTier {
  const isExpanded = useMediaQuery("(min-width: 1024px)")
  const isMedium = useMediaQuery("(min-width: 672px)")
  if (isExpanded) return "expanded"
  if (isMedium) return "medium"
  return "compact"
}

/** 마우스가 아닌 손가락으로 조작하는 기기인지 (터치 타깃·hover 의존 UI 판단용) */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)")
}
