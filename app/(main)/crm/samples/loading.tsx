import { HeaderSkeleton, CrmNavSkeleton, ListHeadSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1000px] px-6 py-6">
        <CrmNavSkeleton />
        <ListHeadSkeleton />
        <CardListSkeleton count={6} lines={2} />
      </div>
    </>
  )
}
