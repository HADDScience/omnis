import { HeaderSkeleton, ListHeadSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
        <ListHeadSkeleton />
        <CardListSkeleton count={6} lines={2} />
      </div>
    </>
  )
}
