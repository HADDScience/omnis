import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 공고 보드 — 제목 · 마감 한 줄, 세 열(폰은 한 열씩 가로로) */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6">
        <div className="mb-4 flex justify-between px-1">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="-mx-4 flex gap-3 overflow-hidden px-4 md:mx-0 md:grid md:grid-cols-3 md:px-0">
          {[3, 2, 1].map((n, i) => (
            <div key={i} className="glass w-[82%] shrink-0 rounded-2xl p-3 md:w-auto">
              <Skeleton className="mb-3 h-4 w-20" />
              {Array.from({ length: n }).map((_, k) => (
                <div key={k} className="mb-2 rounded-xl bg-background/50 p-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-1/3" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
