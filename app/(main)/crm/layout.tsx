import { ArchiveNav } from "@/components/layout/archive-nav"

/** 아카이브 탭(HADD DB · NAS · 지식재산권 · 고객·견적)의 하위 탭 띠 */
export default function ArchiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ArchiveNav />
      {children}
    </>
  )
}
