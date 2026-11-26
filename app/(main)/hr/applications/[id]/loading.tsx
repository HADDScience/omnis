import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 지원서 한 장 — 머리 · 지원자 칸 · 지원 동기 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="glass rounded-2xl p-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
        <div className="glass rounded-2xl p-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="mb-2.5 flex gap-3">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
        <div className="glass rounded-2xl p-4">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-5/6" />
          <Skeleton className="mt-2 h-3 w-4/6" />
        </div>
      </div>
    </>
  )
}
