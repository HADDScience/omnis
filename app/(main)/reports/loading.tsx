import { HeaderSkeleton, ListHeadSkeleton, CardListSkeleton } from "@/components/ui/page-skeleton"

export default function Loading() {
  return (
    <>
      <HeaderSkeleton />
      <div className="mx-auto w-full max-w-[900px] px-6 py-6">
        <ListHeadSkeleton />
        <CardListSkeleton count={5} lines={2} />
      </div>
    </>
  )
}
