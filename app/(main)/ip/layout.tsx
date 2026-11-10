import { ArchiveNav } from "@/components/layout/archive-nav"
import { HeaderSubnavProvider } from "@/components/layout/header-subnav"
import { AppShell } from "@/components/ip/app-shell"

import "./ip.css"

/**
 * 지식재산권 팔로우업 — ip-platform(GitHub Pages)에서 들여온 화면.
 * 제목줄은 AppShell 이 그린다 — IP 버튼(새로고침 · 엑셀 · 기록하기)이 자료를 알아야 해서다. 자료와 권한은 처음부터
 * Omnis 의 /api/ip 였고, 바뀐 것은 로그인이 쿠키로 실린다는 것뿐이다(lib/ip/omnis.ts).
 */
export default function IpLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeaderSubnavProvider subnav={<ArchiveNav />}>
      <AppShell>{children}</AppShell>
    </HeaderSubnavProvider>
  )
}
