// 로고 전환 중 env 를 읽지 못하는 쪽 — next.config.mjs(순수 JS)와 lib/brand.ts 가 함께 쓴다.

/** @typedef {"v1" | "v2"} BrandVersion */

/**
 * NEXT_PUBLIC_BRAND 값 → 로고 판. "v2" 만 새 로고, 나머지(빈 값 · 오타)는 지금 로고.
 * @param {string | undefined} value
 * @returns {BrandVersion}
 */
export function resolveBrand(value) {
  return value?.trim().toLowerCase() === "v2" ? "v2" : "v1"
}

/**
 * 주소가 고정된 정적 로고 — public/sw.js 의 알림 아이콘(/icon-192.png), 브라우저가 스스로 찾는 /favicon.ico,
 * 이미 설치한 앱이 들고 있는 옛 manifest 의 아이콘, 앱 밖에서 걸었을 수 있는 /omnis-logo.png.
 */
export const BRAND_STATIC_PATHS = Object.freeze([
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/omnis-logo.png",
])

/**
 * v2 일 때 위 주소를 public/brand/v2/ 의 같은 이름 파일로 돌린다. v1 이면 빈 목록 — 지금 동작 그대로.
 * public 파일보다 먼저 걸려야 하므로 next.config.mjs 는 이것을 rewrites 의 beforeFiles 에 넣는다.
 * @param {BrandVersion} version
 * @returns {{ source: string, destination: string }[]}
 */
export function brandRewrites(version) {
  if (version !== "v2") return []
  return BRAND_STATIC_PATHS.map((p) => ({ source: p, destination: `/brand/v2${p}` }))
}
