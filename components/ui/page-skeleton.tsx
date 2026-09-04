import { Skeleton } from "@/components/ui/skeleton"

/**
 * 화면이 오는 동안 그 화면의 **모양**을 미리 그린다.
 *
 * 도는 원 하나는 "뭔가 하고 있다"만 말한다. 스켈레톤은 "표가 온다", "카드가 온다"를
 * 말해서, 실제 내용이 도착했을 때 눈이 이미 맞는 자리에 가 있게 한다.
 *
 * 진짜 화면과 줄 수·높이를 비슷하게 맞추는 게 중요하다. 어긋나면 내용이 도착하는
 * 순간 레이아웃이 튀어서, 없느니만 못하다.
 */

export function HeaderSkeleton() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-4">
      <Skeleton className="h-4 w-4 rounded" />
      <Skeleton className="h-3.5 w-40" />
    </div>
  )
}

/** 목록·표 화면 */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex gap-3 border-b bg-muted/40 px-3 py-2.5">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-2.5 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-3 border-b px-3 py-3.5 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3.5 flex-1" style={{ opacity: 1 - r * 0.07 }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 카드가 세로로 쌓이는 화면 */
export function CardListSkeleton({ count = 5, lines = 2 }: { count?: number; lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border bg-card p-3.5"
          style={{ opacity: 1 - i * 0.12 }}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="ml-auto h-5 w-14 rounded-md" />
          </div>
          {Array.from({ length: lines }).map((_, l) => (
            <Skeleton key={l} className="mt-2 h-3 w-full" style={{ maxWidth: `${88 - l * 22}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** 제목 + 건수가 붙는 목록 머리 */
export function ListHeadSkeleton() {
  return (
    <div className="mb-4 flex items-baseline gap-3">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="h-3.5 w-32" />
    </div>
  )
}

/** CRM 안쪽 탭 줄 */
export function CrmNavSkeleton() {
  return (
    <div className="mb-5 flex gap-1 border-b">
      {[40, 56, 60, 32].map((w, i) => (
        <div key={i} className="px-3 py-2">
          <Skeleton className="h-3.5" style={{ width: w }} />
        </div>
      ))}
    </div>
  )
}
