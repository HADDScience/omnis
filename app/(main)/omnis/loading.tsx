import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/**
 * 아카이브(HADD DB) 첫 화면: 가운데 제목 · 회사 자료 타일 넷 · 검색 · 카드 목록.
 * 따로 스켈레톤이 없는 /omnis 아래 화면(카드 상세 등)도 이걸 받는다 — 탭을 옮긴 순간 빈 화면보다 낫다.
 */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-3xl flex-col items-stretch gap-4 p-4">
        <div className="flex flex-col items-center gap-2 py-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-72 max-w-full" />
          <Skeleton className="h-3.5 w-28" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border bg-card p-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="mt-2 h-5 w-28" />
              <Skeleton className="mt-2 h-3 w-36 max-w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-full" />
        <div className="flex flex-wrap gap-2">
          {[40, 64, 56, 64, 72].map((w, i) => (
            <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
          ))}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4" style={{ opacity: 1 - i * 0.2 }}>
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-3 w-full" />
          </div>
        ))}
      </div>
    </>
  )
}
