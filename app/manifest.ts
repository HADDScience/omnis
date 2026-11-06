import type { MetadataRoute } from "next"

import { BASE_PATH } from "@/lib/base-path"
import { brand } from "@/lib/brand"

/**
 * PWA manifest — `/manifest.webmanifest` 로 나간다.
 *
 * 이게 있어야 "홈 화면에 추가"가 앱처럼 뜨고, **iOS 는 홈 화면에 추가한 뒤에야
 * 웹 푸시를 허용한다** (16.4+). Safari 탭에서는 Notification API 자체가 없다.
 *
 * start_url·scope 는 basePath 를 포함해야 한다. 하위 경로(/omnis)로 뜰 때 루트를 가리키면
 * 홈 화면 아이콘이 홈페이지로 들어간다.
 */
export default function manifest(): MetadataRoute.Manifest {
  const base = BASE_PATH || "/"
  return {
    name: "Omnis — HADD Science",
    short_name: "Omnis",
    description: "HADD Science 채팅 기반 업무 관리 시스템",
    start_url: base,
    scope: base,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: brand.themeColor,
    lang: "ko",
    // 이 앱 자신 — 브라우저 탭에서 getInstalledRelatedApps 로 「이미 설치했는가」 를 묻게 한다(lib/pwa.ts detectInstalled).
    // 주소는 manifest 주소 기준으로 풀린다
    related_applications: [{ platform: "webapp", url: `${BASE_PATH}/manifest.webmanifest` }],
    // 아이콘은 lib/brand.ts 가 고른다. v2 는 주소가 바뀐다(public/brand/v2/) — 설치한 안드로이드 앱이 바뀐 아이콘을 알아챈다
    icons: brand.manifestIcons.map((i) => ({ ...i, src: `${BASE_PATH}${i.src}` })),
  }
}
