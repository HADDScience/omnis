import { Skeleton } from "@/components/ui/skeleton"

/** 방을 여는 동안 — 머리 한 줄 + 오가는 말 몇 줄 + 입력창. 실제 대화 칸과 높이를 맞춘다 */
export function RoomSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy aria-label="대화를 불러오는 중">
      <div className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 py-1">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-5 px-3 py-4 sm:px-6">
        <Skeleton className="ml-auto h-9 w-1/2 rounded-2xl" />
        <div className="flex gap-2.5">
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
        <Skeleton className="ml-auto h-9 w-1/3 rounded-2xl" />
      </div>
      <div className="shrink-0 border-t px-3 pb-3 pt-2 sm:px-6">
        <Skeleton className="mx-auto h-11 w-full max-w-[760px] rounded-2xl" />
      </div>
    </div>
  )
}
