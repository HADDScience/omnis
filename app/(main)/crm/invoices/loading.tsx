import { HeaderSkeleton, CrmNavSkeleton, ListHeadSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
        <CrmNavSkeleton />
        <ListHeadSkeleton />
        <CardListSkeleton count={6} lines={2} />
      </div>
    </>
  )
}
