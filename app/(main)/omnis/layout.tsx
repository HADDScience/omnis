import { ArchiveNav } from "@/components/layout/archive-nav"
import { HeaderSubnavProvider } from "@/components/layout/header-subnav"

/** 아카이브 탭(HADD DB · NAS · 지식재산권 · 고객·견적)의 하위 탭 띠 — 각 페이지 제목줄 바로 아래에 붙는다 */
export default function ArchiveLayout({ children }: { children: React.ReactNode }) {
  return <HeaderSubnavProvider subnav={<ArchiveNav />}>{children}</HeaderSubnavProvider>
}
