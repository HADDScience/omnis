import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 지원서함 — 공고 카드 몇 장 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2 px-4 py-6 sm:px-6">
        {[0, 1].map((i) => (
          <div key={i} className="glass rounded-2xl px-4 py-3.5" style={{ opacity: 1 - i * 0.3 }}>
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-2 h-3 w-40" />
            <div className="mt-2.5 flex gap-1.5">
              {[0, 1, 2].map((k) => (
                <Skeleton key={k} className="h-5 w-16 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
