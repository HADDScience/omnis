import { HeaderSkeleton, CrmNavSkeleton, ListHeadSkeleton, CardListSkeleton, TableSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1000px] px-6 pb-20 pt-6">
        <CrmNavSkeleton />
        <ListHeadSkeleton />
        <CardListSkeleton count={2} lines={3} />
        <div className="mt-8">
          <ListHeadSkeleton />
          <TableSkeleton rows={7} cols={7} />
        </div>
      </div>
    </>
  )
}
