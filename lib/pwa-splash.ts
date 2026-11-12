// 홈 화면에 추가한 앱(PWA)을 켤 때의 첫 화면 — iOS 시작 이미지(apple-touch-startup-image)와 HTML 스플래시가 같은 값을 본다.
//
// iOS 는 manifest 의 background_color · 아이콘으로 시작 화면을 그리지 않는다. 기기 화면 크기와 정확히 맞는
// apple-touch-startup-image 가 없으면 첫 HTML 이 그려질 때까지 빈 화면이다(2026-11-12 「검은 화면만 나온다」).
// 그래서 기기별 크기 · 라이트/다크로 그림을 내고(app/splash/[file]/route.ts), 첫 HTML 은 같은 자리에 같은 타일을 그린다
// (components/layout/app-splash.tsx). 그림 → HTML → 화면으로 넘어갈 때 타일이 제자리에 있어야 튀지 않는다.

/** 화면 바탕 — globals.css 의 --background(라이트 oklch(1 0 0) · 다크 oklch(0.145 0 0))와 같은 색 */
export const SPLASH_BACKGROUND = { light: "#ffffff", dark: "#0a0a0a" } as const

/** 가운데 앱 타일의 크기(CSS px). 그림과 HTML 스플래시가 같은 값을 쓴다 */
export const SPLASH_TILE_PX = 96

export type SplashTheme = keyof typeof SPLASH_BACKGROUND

/** CSS 폭 · 높이(세로 방향) · 기기 픽셀 비율 */
type Screen = { width: number; height: number; ratio: number; tablet?: boolean }

/*
 * 기기 목록 — iOS 는 media 가 정확히 맞는 그림만 쓴다(하나라도 어긋나면 빈 화면). 같은 CSS 크기 · 비율이면 한 줄로 충분하다.
 * 폰은 세로만(앱이 세로로 뜬다), 태블릿은 가로 · 세로 둘 다.
 */
export const SPLASH_SCREENS: readonly Screen[] = [
  { width: 440, height: 956, ratio: 3 }, // 16 Pro Max · 17 Pro Max
  { width: 402, height: 874, ratio: 3 }, // 16 Pro · 17 · 17 Pro
  { width: 420, height: 912, ratio: 3 }, // Air
  { width: 430, height: 932, ratio: 3 }, // 14 Pro Max · 15 Plus · 15 Pro Max · 16 Plus
  { width: 393, height: 852, ratio: 3 }, // 14 Pro · 15 · 15 Pro · 16
  { width: 428, height: 926, ratio: 3 }, // 12 Pro Max · 13 Pro Max · 14 Plus
  { width: 390, height: 844, ratio: 3 }, // 12 · 12 Pro · 13 · 13 Pro · 14 · 16e
  { width: 375, height: 812, ratio: 3 }, // X · XS · 11 Pro · 12 mini · 13 mini
  { width: 414, height: 896, ratio: 3 }, // XS Max · 11 Pro Max
  { width: 414, height: 896, ratio: 2 }, // XR · 11
  { width: 414, height: 736, ratio: 3 }, // 6+ · 7+ · 8+
  { width: 375, height: 667, ratio: 2 }, // 6 · 7 · 8 · SE 2/3세대
  { width: 320, height: 568, ratio: 2 }, // SE 1세대
  { width: 1032, height: 1376, ratio: 2, tablet: true }, // iPad Pro 13 (M4)
  { width: 1024, height: 1366, ratio: 2, tablet: true }, // iPad Pro 12.9
  { width: 834, height: 1210, ratio: 2, tablet: true }, // iPad Pro 11 (M4)
  { width: 834, height: 1194, ratio: 2, tablet: true }, // iPad Pro 11
  { width: 820, height: 1180, ratio: 2, tablet: true }, // iPad Air 10.9 · iPad 10세대
  { width: 810, height: 1080, ratio: 2, tablet: true }, // iPad 10.2
  { width: 768, height: 1024, ratio: 2, tablet: true }, // iPad 9.7 · mini 5
  { width: 744, height: 1133, ratio: 2, tablet: true }, // iPad mini 6 · 7
]

export type SplashImage = {
  /** 그림 파일 이름 — /splash/<file> */
  file: string
  /** 실제 픽셀 */
  width: number
  height: number
  ratio: number
  theme: SplashTheme
  media: string
}

/** 시작 이미지 전부 — 기기 × 방향 × 테마. 그림 라우트의 정적 생성과 <link> 가 같은 목록을 본다 */
export function splashImages(): SplashImage[] {
  const out: SplashImage[] = []
  for (const s of SPLASH_SCREENS) {
    const orientations: ("portrait" | "landscape")[] = s.tablet ? ["portrait", "landscape"] : ["portrait"]
    for (const orientation of orientations) {
      for (const theme of ["light", "dark"] as const) {
        const cssW = orientation === "portrait" ? s.width : s.height
        const cssH = orientation === "portrait" ? s.height : s.width
        const width = cssW * s.ratio
        const height = cssH * s.ratio
        out.push({
          file: `${width}x${height}-${theme}.png`,
          width,
          height,
          ratio: s.ratio,
          theme,
          // device-width/height 는 방향과 상관없이 세로 기준 값이다
          media:
            `(device-width: ${s.width}px) and (device-height: ${s.height}px) and (-webkit-device-pixel-ratio: ${s.ratio})` +
            ` and (orientation: ${orientation}) and (prefers-color-scheme: ${theme})`,
        })
      }
    }
  }
  return out
}

/** /splash/<file> 이름을 풀어 그림 한 장을 찾는다. 목록에 없는 이름은 null(라우트가 404) */
export function findSplashImage(file: string): SplashImage | null {
  return splashImages().find((i) => i.file === file) ?? null
}
