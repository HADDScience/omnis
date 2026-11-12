import { apiUrl } from "@/lib/base-path"
import { brand } from "@/lib/brand"
import { SPLASH_BACKGROUND, SPLASH_TILE_PX } from "@/lib/pwa-splash"

const TILE = SPLASH_TILE_PX
const iconSrc = brand.manifestIcons.find((i) => i.sizes === "512x512" && i.purpose === "any")?.src ?? "/icon-512.png"

/*
 * 인라인 CSS — 첫 HTML 조각에 실려 JS 를 받기 전(하이드레이션 전)에도 그려진다. 클래스 이름이 아니라 이 글이 스타일이라
 * 빌드한 CSS 의 어느 규칙에도 기대지 않는다. 다크는 next-themes 가 html 에 다는 .dark 를 본다.
 * 점 세 개는 은은하게 숨 쉬듯 — 움직임 줄이기를 켠 기기에서는 멈춰 있는 점이다.
 */
const CSS = `
#omnis-splash{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;background:${SPLASH_BACKGROUND.light}}
.dark #omnis-splash{background:${SPLASH_BACKGROUND.dark}}
#omnis-splash img{width:${TILE}px;height:${TILE}px;display:block;user-select:none;-webkit-user-drag:none}
#omnis-splash .omnis-splash-dots{position:absolute;left:50%;top:calc(50% + ${TILE / 2 + 28}px);display:flex;gap:6px;transform:translateX(-50%)}
#omnis-splash .omnis-splash-dots i{width:6px;height:6px;border-radius:9999px;background:#1447e6;opacity:.18;animation:omnis-splash-dot 1.2s ease-in-out infinite}
.dark #omnis-splash .omnis-splash-dots i{background:#8ea8ff}
#omnis-splash .omnis-splash-dots i:nth-child(2){animation-delay:.16s}
#omnis-splash .omnis-splash-dots i:nth-child(3){animation-delay:.32s}
@keyframes omnis-splash-dot{0%,80%,100%{opacity:.18;transform:scale(.85)}40%{opacity:.7;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){#omnis-splash .omnis-splash-dots i{animation:none}#omnis-splash .omnis-splash-dots i{opacity:.35}}
`

/**
 * 앱을 여는 동안의 첫 화면 — (main) 셸이 서버에서 세션 · 사용자 정보를 읽는 동안 Suspense 자리에 먼저 나간다(app/(main)/layout.tsx).
 * 그 읽기는 콜드 스타트 · DB 깨우기와 겹치면 수 초가 걸려, 예전에는 그동안 응답이 한 바이트도 오지 않아 빈 화면이었다.
 *
 * 가운데 앱 타일은 iOS 시작 이미지(app/splash/[file]/route.ts)와 같은 크기 · 자리다 — 그림에서 HTML 로 넘어갈 때 타일이 제자리에 있다.
 * 셸이 도착하면 React 가 이 자리를 셸로 바꾼다. 따로 걷어 낼 스크립트가 없다.
 */
export function AppSplash() {
  return (
    <div id="omnis-splash" role="status" aria-label="옴니스를 여는 중">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- 하이드레이션 전에 그려져야 하는 정적 아이콘 */}
      <img src={apiUrl(iconSrc)} alt="" width={TILE} height={TILE} fetchPriority="high" decoding="async" />
      <div className="omnis-splash-dots" aria-hidden>
        <i />
        <i />
        <i />
      </div>
    </div>
  )
}
