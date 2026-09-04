import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton, ListHeadSkeleton } from "@/components/ui/page-skeleton"

/** 업무 목록은 칸반 보드다. 세로 카드가 아니라 가로로 늘어선 열을 그린다. */
export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="p-4">
        <ListHeadSkeleton />
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((col) => (
            <div key={col} className="w-[280px] shrink-0" style={{ opacity: 1 - col * 0.18 }}>
              <div className="mb-2 flex items-center gap-2">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="ml-auto h-3 w-6" />
              </div>
              <div className="flex flex-col gap-2">
                {Array.from({ length: 4 - col }).map((_, i) => (
                  <div key={i} className="rounded-xl border bg-card p-3">
                    <Skeleton className="h-3.5 w-[85%]" />
                    <Skeleton className="mt-2 h-2.5 w-[60%]" />
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <Skeleton className="h-4 w-4 rounded-full" />
                      <Skeleton className="h-4 w-20 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
