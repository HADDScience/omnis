import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"
import { DecisionListSkeleton } from "@/components/grants/decision-skeletons"

/** 국가과제 — 제목 · 탭 둘 · 필터 칩 · 한 줄 목록의 모양 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1040px] px-4 py-6 sm:px-6">
        <Skeleton className="mb-4 h-5 w-24" />
        <div className="mb-4 flex gap-1.5">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <DecisionListSkeleton />
      </div>
    </>
  )
}
