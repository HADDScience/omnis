import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

/** 업무 상세. 진짜 화면의 카드 순서(제목 · 정보 · 개요 · 체크리스트)를 그대로 흉내낸다. */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
        <div className="rounded-xl border bg-card p-4">
          <Skeleton className="h-5 w-2/3" />
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="mt-1.5 h-2.5 w-20" />
            </div>
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="mt-1.5 h-4 w-20" />
            </div>
            <div>
              <Skeleton className="h-2.5 w-12" />
              <Skeleton className="mt-1.5 h-4 w-14" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4" style={{ opacity: 0.75 }}>
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-[92%]" />
          <Skeleton className="mt-2 h-3 w-[70%]" />
        </div>

        <div className="rounded-xl border bg-card p-4" style={{ opacity: 0.55 }}>
          <Skeleton className="h-3.5 w-16" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="mt-3 flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3 flex-1" style={{ maxWidth: `${70 - i * 12}%` }} />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
