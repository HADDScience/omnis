import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 마이: 프로필 줄 · 바로가기 목록 카드 · 설정 탭 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
        <div className="flex items-center gap-3 px-1">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>
        <div className="divide-y rounded-xl border bg-card">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex min-h-11 items-center gap-3 px-3 py-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className="h-3.5" style={{ width: [200, 150, 60, 50, 64][i] }} />
            </div>
          ))}
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    </>
  )
}
