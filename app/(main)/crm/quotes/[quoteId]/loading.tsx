import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton, TableSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[860px] px-6 pb-20 pt-6">
        <div className="mb-5 flex items-baseline gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-12 rounded-md" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <div className="rounded-xl border bg-card p-4">
            <Skeleton className="mb-3 h-2.5 w-12" />
            <TableSkeleton rows={2} cols={4} />
            <div className="mt-4 flex flex-col gap-2 border-t pt-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border bg-card p-4" style={{ opacity: 0.7 }}>
            <Skeleton className="mb-2.5 h-2.5 w-14" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-1.5 h-2.5 w-24" />
          </div>
        </div>
      </div>
    </>
  )
}
