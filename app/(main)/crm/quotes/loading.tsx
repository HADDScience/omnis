import { HeaderSkeleton, CrmNavSkeleton, ListHeadSkeleton, TableSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <CrmNavSkeleton />
        <ListHeadSkeleton />
        <TableSkeleton rows={9} cols={7} />
      </div>
    </>
  )
}
