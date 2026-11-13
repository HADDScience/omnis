import { Skeleton } from "@/components/ui/skeleton"

/** 관리자 페이지 본문 — 메뉴는 레이아웃에 그대로 있고 본문 카드 자리만 비운다 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-64 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  )
}
