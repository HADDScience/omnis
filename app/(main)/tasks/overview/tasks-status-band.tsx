"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { startOfMonth, startOfWeek } from "date-fns"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { TasksOverviewSheet, type TasksOverviewSheetProps } from "./tasks-overview-sheet"

type PeriodKey = "week" | "month" | "all"

const PERIOD_LABELS: Record<PeriodKey, string> = {
  week: "이번 주",
  month: "이번 달",
  all: "전체",
}

interface ProgressTask {
  status: string
  updatedAt: string
}

interface MemberChip {
  id: string
  name: string
  inProgress: number
}

interface TasksStatusBandProps extends TasksOverviewSheetProps {
  tasksForProgress: ProgressTask[]
  stalledCount: number
  members: MemberChip[]
  /** 지금 걸린 목록 필터 — 같은 칩을 다시 누르면 풀린다 */
  activeFilter: string | null
  activeAssignee: string | null
}

const CHIP =
  "touch-hit inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

/**
 * 「업무」 탭 맨 위 현황 띠 한 줄 — 진행률 · 멈춤 · 사람별 진행 건수.
 *
 * 예전 워크스페이스 화면의 맨 위 세 카드를 한 줄로 접었다. 칩은 숫자를 보여 주는 데서
 * 그치지 않고 바로 아래 목록의 필터다 — 「멈춤 3」 을 보면 그 셋을 보고 싶어지기 때문이다.
 * 카드 원본은 「상세 ›」 시트에 그대로 있다.
 */
export function TasksStatusBand({
  tasksForProgress,
  stalledCount,
  members,
  activeFilter,
  activeAssignee,
  ...sheet
}: TasksStatusBandProps) {
  const [period, setPeriod] = useState<PeriodKey>("week")

  const stats = useMemo(() => {
    const now = new Date()
    const cutoff =
      period === "week"
        ? startOfWeek(now, { weekStartsOn: 1 })
        : period === "month"
          ? startOfMonth(now)
          : null
    const inPeriod = cutoff
      ? tasksForProgress.filter((t) => new Date(t.updatedAt) >= cutoff)
      : tasksForProgress
    const done = inPeriod.filter((t) => t.status === "DONE").length
    return {
      total: inPeriod.length,
      done,
      rate: inPeriod.length > 0 ? Math.round((done / inPeriod.length) * 100) : 0,
    }
  }, [period, tasksForProgress])

  const stalledActive = activeFilter === "stalled"

  return (
    <div className="flex shrink-0 items-center gap-2 border-b bg-background px-4 py-1.5 [@media(pointer:coarse)]:py-0">
      {/* 칩이 늘어도 높이는 한 줄 — 넘치면 가로로 민다. 「상세」 는 밀려 나가지 않게 바깥에 둔다.
          터치 기기에서는 칩의 44px 누름 막이 가로 스크롤 칸에 잘리지 않게 칸 높이를 44px 로 두고,
          오른쪽 끝을 흐려 칩이 더 있다는 걸 보인다(잘린 칩이 깨진 것처럼 보였다) */}
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] [scrollbar-width:none] [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:pr-4">
        <div
          className="flex shrink-0 items-center gap-2"
          title={`${PERIOD_LABELS[period]} 움직인 업무 ${stats.total}건 중 완료 ${stats.done}건`}
        >
          <Progress
            value={stats.rate}
            aria-label={`${PERIOD_LABELS[period]} 완료율`}
            className="w-12 sm:w-32"
          />
          <span className="text-[12px] font-medium tabular-nums">{stats.rate}%</span>
        </div>
        {/* 네이티브 select 는 누르는 자리를 막으로 넓힐 수 없어, 폰에서 44px 상자로 부풀었다 — 칩 모양 메뉴로 바꾼다 */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`진행률 기간 · ${PERIOD_LABELS[period]}`}
                className={cn(CHIP, "gap-1 bg-card text-foreground hover:bg-muted data-[popup-open]:bg-muted")}
              />
            }
          >
            {PERIOD_LABELS[period]}
            <HugeiconsIcon icon={ArrowDown01Icon} size={10} aria-hidden className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[120px]">
            <DropdownMenuRadioGroup value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
              {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {PERIOD_LABELS[key]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-4 self-center!" />

        <Link
          href={stalledActive ? "/tasks" : "/tasks?filter=stalled"}
          aria-current={stalledActive ? "true" : undefined}
          title="확인 안 함 · 3일째 진행 중 · 완료 확인 대기"
          className={cn(
            CHIP,
            stalledCount > 0
              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
              : "bg-card text-muted-foreground hover:bg-muted",
            stalledActive && "ring-2 ring-amber-400/60"
          )}
        >
          <HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden />
          멈춤
          <span className="tabular-nums">{stalledCount}</span>
        </Link>

        {members.map((m) => {
          const active = activeAssignee === m.id
          return (
            <Link
              key={m.id}
              href={active ? "/tasks" : `/tasks?assignee=${m.id}`}
              aria-current={active ? "true" : undefined}
              aria-label={`${m.name} 담당 업무만 보기 · 진행 중 ${m.inProgress}건`}
              className={cn(
                CHIP,
                "pl-1",
                active
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "bg-card text-foreground hover:bg-muted"
              )}
            >
              <span
                aria-hidden
                className="flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
              >
                {m.name.charAt(0)}
              </span>
              {m.name}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10.5px] tabular-nums",
                  m.inProgress > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                {m.inProgress}
              </span>
            </Link>
          )
        })}
      </div>

      <Sheet>
        <SheetTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="touch-target shrink-0 gap-0.5 px-2 text-[11.5px] text-primary"
            />
          }
        >
          상세
          <HugeiconsIcon icon={ArrowRight01Icon} size={13} aria-hidden />
        </SheetTrigger>
        <SheetContent
          side="right"
          className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        >
          <SheetHeader>
            <SheetTitle>업무 현황</SheetTitle>
            <SheetDescription className="text-xs">
              멈춰 있는 업무 · 팀원별 현황 · 과제와 가점항목
            </SheetDescription>
          </SheetHeader>
          <TasksOverviewSheet {...sheet} />
        </SheetContent>
      </Sheet>
    </div>
  )
}
