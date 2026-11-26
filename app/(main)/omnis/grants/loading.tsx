import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

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
        <div className="mb-2.5 flex gap-1.5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-16 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="glass overflow-hidden rounded-2xl">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="border-b border-[var(--glass-edge)] px-3 py-3 last:border-0"
              style={{ opacity: 1 - i * 0.08 }}
            >
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-4 w-10 rounded-full" />
                <Skeleton className="h-3.5 w-3/5" />
              </div>
              <Skeleton className="mt-1.5 h-3 w-2/5" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
