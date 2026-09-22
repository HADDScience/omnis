import type { MetadataRoute } from "next"

import { BASE_PATH } from "@/lib/base-path"

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
    theme_color: "#1447e6",
    lang: "ko",
    icons: [
      { src: `${BASE_PATH}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${BASE_PATH}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: `${BASE_PATH}/icon-maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  }
}
