import { Skeleton } from "@/components/ui/skeleton"

/** 우리 결정 목록 — 필터 칩 · 한 줄 목록의 모양 */
export function DecisionListSkeleton() {
  return (
    <>
      <div className="mb-2.5 flex gap-1.5 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
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
    </>
  )
}

/** 우리 결정 보드 — 일곱 열(폰은 한 열씩 가로로), 지원서함 보드와 같은 카드 모양 */
export function BoardSkeleton() {
  return (
    <div
      className="-mx-4 flex gap-3 overflow-hidden px-4 sm:-mx-6 sm:px-6 xl:mx-0 xl:grid xl:grid-cols-7 xl:px-0"
      aria-hidden
    >
      {[4, 2, 3, 1, 1, 1, 3].map((n, i) => (
        <div
          key={i}
          className="glass w-[82%] shrink-0 rounded-2xl p-2.5 md:w-[232px] xl:w-auto"
        >
          <Skeleton className="mx-1.5 mb-3 h-4 w-16" />
          {Array.from({ length: n }).map((_, k) => (
            <div key={k} className="mb-2 rounded-xl bg-background/50 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="mt-2 h-3 w-1/2" />
              <Skeleton className="mt-1.5 h-3 w-2/3" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
