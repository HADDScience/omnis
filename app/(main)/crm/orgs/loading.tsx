import { HeaderSkeleton, CrmNavSkeleton, ListHeadSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <CrmNavSkeleton />
        <ListHeadSkeleton />
        <CardListSkeleton count={7} lines={1} />
      </div>
    </>
  )
}
