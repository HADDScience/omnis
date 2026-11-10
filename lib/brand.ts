// 로고 고르기 — Omnis 로고를 쓰는 모든 자리는 여기서 경로를 받는다.
//
// 켜고 끄는 것은 빌드 env 다: NEXT_PUBLIC_BRAND=v2 면 새 로고, 비어 있거나 다른 값이면 지금 로고(v1).
// NEXT_PUBLIC_ 값은 빌드할 때 번들에 박힌다 — 바꾸려면 env 를 넣고 **재배포**한다. 되돌리기도 같다.
//
// 자산 위치
// - v1: 지금 자리 그대로(public/omnis-logo.png · icon-192.png … · app/icon.png 가 옮겨 간 public/brand/v1/).
//   v1 은 경로도 내용도 바꾸지 않는다 — 이 파일이 들어와도 화면은 그대로여야 한다.
// - v2: public/brand/v2/ — scripts/brand/build-v2.sh 가 원본 SVG 에서 만든다.
//
// 정적 파일이라 env 를 읽지 못하는 자리(public/sw.js 의 알림 아이콘, 브라우저가 스스로 찾는 /favicon.ico,
// 이미 설치한 앱이 들고 있는 옛 manifest 의 아이콘 주소)는 next.config.mjs 의 rewrites(beforeFiles) 가
// v2 일 때만 같은 주소를 public/brand/v2/ 로 돌린다 — lib/brand-static.mjs 의 brandRewrites().

import { resolveBrand } from "./brand-static.mjs"

export type BrandVersion = "v1" | "v2"
export { resolveBrand }

export const BRAND: BrandVersion = resolveBrand(process.env.NEXT_PUBLIC_BRAND)

export type BrandAssets = {
  /** 로고 타일(OmnisMark) 위에 올리는 흰 마크 — 여백 없이 마크 외곽에 맞춘 그림 */
  tileMark: string
  /** 밝은 바탕에 그대로 놓는 마크. v1 은 따로 없어 null */
  mark: string | null
  /** 어두운 바탕용 흰 마크 */
  markOnDark: string
  /** <link rel="icon"> · <link rel="apple-touch-icon"> — 앱 라우터 파일 규칙(app/icon.png) 대신 여기서 낸다 */
  icon: { url: string; type: string; sizes: string }[]
  apple: { url: string; sizes: string }
  /** manifest 아이콘 */
  manifestIcons: { src: string; sizes: string; type: string; purpose: "any" | "maskable" }[]
  /** 주소창 · 작업 전환 화면의 색 */
  themeColor: string
  /** 로딩 표시 — v1 은 지금의 돌아가는 원(Spinner), v2 는 OmnisLoader */
  loader: "spinner" | "omnis"
}

const V2 = "/brand/v2"

export const BRAND_ASSETS: Record<BrandVersion, BrandAssets> = {
  v1: {
    tileMark: "/omnis-logo.png",
    mark: null,
    markOnDark: "/omnis-logo.png",
    icon: [{ url: "/brand/v1/icon.png", type: "image/png", sizes: "512x512" }],
    apple: { url: "/brand/v1/apple-icon.png", sizes: "180x180" },
    manifestIcons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    themeColor: "#1447e6",
    loader: "spinner",
  },
  v2: {
    tileMark: `${V2}/omnis-logo.svg`,
    mark: `${V2}/omnis-mark.svg`,
    markOnDark: `${V2}/omnis-mark-white.svg`,
    icon: [
      { url: `${V2}/favicon.ico`, type: "image/x-icon", sizes: "16x16 32x32 48x48" },
      { url: `${V2}/omnis-appicon.svg`, type: "image/svg+xml", sizes: "any" },
      { url: `${V2}/icon.png`, type: "image/png", sizes: "512x512" },
    ],
    apple: { url: `${V2}/apple-icon.png`, sizes: "180x180" },
    manifestIcons: [
      { src: `${V2}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${V2}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${V2}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    themeColor: "#044ABF",
    loader: "omnis",
  },
}

export const brand: BrandAssets = BRAND_ASSETS[BRAND]
