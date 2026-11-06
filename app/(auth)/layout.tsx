import type { Metadata } from "next"

import { apiUrl } from "@/lib/base-path"
import { brand } from "@/lib/brand"

/**
 * 로그인 화면의 탭 제목만 갈아 끼운다.
 *
 * 루트 레이아웃은 "Omnis — HADD Science" 를 쓴다. 그건 제품 화면에서 맞는 이름이지만
 * 이 아래는 사내 공통 로그인이라, 허브나 다른 도구에서 넘어온 사람의 탭에 남의 제품
 * 이름이 뜬다. 탭 목록에서 "내가 왜 Omnis 에 와 있지"로 읽힌다.
 *
 * page.tsx 가 "use client" 라 거기서는 metadata 를 내보낼 수 없어 레이아웃에 둔다.
 */
export const metadata: Metadata = {
  title: "로그인 — HADD SCIENCE",
  /*
   * 탭 아이콘도 회사(HADD) 마크다. 예전에는 이 폴더의 icon.png(파일 규칙)가 맡았는데, 루트 레이아웃이
   * 로고 전환(lib/brand.ts) 때문에 metadata.icons 로 아이콘을 내면서 파일 규칙이 덮이지 않게 됐다 —
   * 그래서 여기서도 metadata 로 낸다. icons 는 통째로 바뀌므로 홈 화면 아이콘(apple)은 루트 것을 그대로 싣는다.
   */
  icons: {
    icon: [{ url: apiUrl("/brand/hadd/icon.png"), type: "image/png", sizes: "512x512" }],
    apple: [{ url: apiUrl(brand.apple.url), sizes: brand.apple.sizes }],
  },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
