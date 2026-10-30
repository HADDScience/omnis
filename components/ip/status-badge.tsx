import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { staleLevel } from "@/lib/ip/date"

/**
 * 단계 → 색 톤. 상표/특허를 합친 통합 파이프라인 전체를 덮는다.
 * 값 자체는 ip.status_options 에서 오므로, 여기 없는 단계는 회색으로 떨어진다.
 */
const EMERALD =
  "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300"
const SKY = "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
const INDIGO =
  "bg-indigo-500/12 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300"
const AMBER =
  "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300"
const RED = "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300"
const VIOLET =
  "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300"
const MUTED = "bg-muted text-muted-foreground"

const STATUS_TONE: Record<string, string> = {
  아이디어: VIOLET,
  검토요청: SKY,
  검토의견: AMBER,
  출원준비: INDIGO,
  출원: INDIGO,
  출원공고: SKY,
  의견제출통지: RED,
  보정서제출: AMBER,
  심사중: AMBER,
  등록: EMERALD,
  거절확정: RED,
  "포기·중단": MUTED,
}

export function StatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  return (
    <Badge
      className={cn(
        "font-medium",
        STATUS_TONE[status] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      {status}
    </Badge>
  )
}

const PRIORITY_TONE: Record<string, string> = {
  높음: "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300",
  보통: "bg-amber-500/15 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  낮음: "bg-muted text-muted-foreground",
}

export function PriorityBadge({
  priority,
  className,
}: {
  priority: string
  className?: string
}) {
  return (
    <Badge
      className={cn(
        "font-medium",
        PRIORITY_TONE[priority] ?? "bg-muted text-muted-foreground",
        className
      )}
    >
      {priority}
    </Badge>
  )
}

const STALE_TONE: Record<string, string> = {
  정상: "text-muted-foreground",
  주의: "text-amber-600 dark:text-amber-400",
  지연: "text-orange-600 dark:text-orange-400",
  심각: "text-red-600 dark:text-red-400 font-semibold",
}

/** 방치 일수. 오래 정체될수록 눈에 띄게. */
export function StaleDays({
  days,
  className,
}: {
  days: number | null
  className?: string
}) {
  const level = staleLevel(days)
  return (
    <span
      className={cn("tabular-nums", STALE_TONE[level], className)}
      title={`정체 판정: ${level}`}
    >
      {days === null ? "—" : `${days}일`}
    </span>
  )
}

export function OpenBadge({ className }: { className?: string }) {
  return (
    <Badge
      className={cn(
        "bg-red-500/12 font-medium text-red-700 dark:bg-red-400/15 dark:text-red-300",
        className
      )}
    >
      미결
    </Badge>
  )
}
