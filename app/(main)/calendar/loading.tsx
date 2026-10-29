import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 캘린더는 달 머리 + 7칸 격자 + 오른쪽 하루 일정이다. 칸 높이를 실제(폰 52px · sm 96px)와 맞춘다 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3 p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-6 rounded" />
          <Skeleton className="h-7 w-12 rounded-md" />
          <Skeleton className="ml-auto h-7 w-14 rounded-md" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid grid-cols-7 overflow-hidden rounded-md border">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="h-[52px] border-r border-b p-1 sm:h-[96px]">
                <Skeleton className="h-3 w-4" style={{ opacity: 1 - Math.floor(i / 7) * 0.12 }} />
              </div>
            ))}
          </div>
          <div className="hidden flex-col gap-2 lg:flex">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-36 w-full rounded-xl" />
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-4 w-full" style={{ opacity: 1 - i * 0.15 }} />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
