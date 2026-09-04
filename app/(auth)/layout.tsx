import type { Metadata } from "next"

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
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
