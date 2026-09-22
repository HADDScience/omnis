import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[760px] px-6 py-6">
        <div className="mb-4 flex items-baseline gap-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="h-4 w-14 rounded-md" />
        </div>
        <div className="rounded-xl border bg-card p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="mb-1.5 flex gap-4">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
          <div className="mt-3 border-t pt-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-2/3" />
          </div>
        </div>
        <div className="mt-4 rounded-xl border bg-card p-4">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="mt-3 h-8 w-full" />
          <Skeleton className="mt-3 h-8 w-40" />
        </div>
      </div>
    </>
  )
}
