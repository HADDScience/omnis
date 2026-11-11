import { HeaderSkeleton } from "@/components/ui/page-skeleton"
import { Skeleton } from "@/components/ui/skeleton"

/** 설문: 충족도 막대 셋 · 질문 · 보기 칩 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6" />)}
        </div>
        <Skeleton className="h-7 w-3/4" />
        <div className="flex flex-wrap gap-2">
          {[92, 120, 76, 104].map((w) => <Skeleton key={w} className="h-[44px] rounded-full" style={{ width: w }} />)}
        </div>
      </div>
    </>
  )
}
