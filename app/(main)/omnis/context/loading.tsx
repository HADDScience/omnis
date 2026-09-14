import { HeaderSkeleton, ListHeadSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6">
        <ListHeadSkeleton />
        <div className="h-[58vh] min-h-[380px] animate-pulse rounded-xl border bg-muted/40" />
      </div>
    </>
  )
}
