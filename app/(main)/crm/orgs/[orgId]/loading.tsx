import { Skeleton } from "@/components/ui/skeleton"
import { HeaderSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[900px] px-6 pb-20 pt-6">
        <div className="mb-5 flex items-baseline gap-2.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-12 rounded-md" />
        </div>
        <CardListSkeleton count={3} lines={2} />
      </div>
    </>
  )
}
