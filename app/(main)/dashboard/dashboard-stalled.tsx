"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, CheckmarkCircle02Icon, Clock01Icon, UserQuestion01Icon } from "@hugeicons/core-free-icons"
import { formatDistanceToNow } from "date-fns"
import { ko } from "date-fns/locale"

export interface StalledTask {
  id: string
  name: string
  slug: string
  ownerName: string
  /** 이 업무가 이 상태로 머문 시작 시각 (ISO) */
  since: string
}

export interface StalledGroups {
  /** 지시가 갔는데 담당자가 아직 열어보지도 않은 업무 */
  unacknowledged: StalledTask[]
  /** 진행 중으로 표시된 채 사흘 넘게 아무 변화가 없는 업무 */
  stale: StalledTask[]
  /** 끝난 것으로 보이는데 담당자 확인이 안 된 업무 */
  awaitingDone: StalledTask[]
}

/** 탭 정의. 세 줄 모두 같은 모양의 목록이라 행 컴포넌트는 하나만 둔다(규칙 25 예외). */
const LANES = [
  {
    key: "unacknowledged" as const,
    label: "확인 안 함",
    icon: UserQuestion01Icon,
    title: "확인을 기다리는 업무가 없습니다",
    description: "지시한 업무를 담당자가 모두 확인했습니다.",
    note: "지시가 도착했지만 담당자가 아직 수락하지 않았습니다.",
  },
  {
    key: "stale" as const,
    label: "3일째 진행 중",
    icon: Clock01Icon,
    title: "멈춰 있는 업무가 없습니다",
    description: "진행 중인 업무가 모두 최근에 움직였습니다.",
    note: "진행 중으로 둔 채 사흘 넘게 변화가 없습니다.",
  },
  {
    key: "awaitingDone" as const,
    label: "완료 확인 대기",
    icon: CheckmarkCircle02Icon,
    title: "확인을 기다리는 완료가 없습니다",
    description: "끝난 업무는 모두 담당자가 완료로 확인했습니다.",
    note: "완료로 보이지만 담당자 확인이 남았습니다.",
  },
]

/**
 * 정체된 업무를 한 자리에 모아 보여준다.
 *
 * 요점은 목록이 아니라 **누구에게 보이느냐**다(인수인계 §4-2 위반 가시화).
 * 담당자 개인 화면이 아니라 팀이 함께 보는 대시보드에 두어,
 * 재촉이 사람의 입이 아니라 화면에서 나오게 한다.
 */
export function DashboardStalled({ groups }: { groups: StalledGroups }) {
  const total = groups.unacknowledged.length + groups.stale.length + groups.awaitingDone.length

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <HugeiconsIcon icon={Alert02Icon} size={15} className="text-muted-foreground" aria-hidden />
            멈춰 있는 업무
          </CardTitle>
          {total > 0 && (
            <Badge variant="secondary" className="h-5 px-2 text-[11px]">
              {total}건
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={LANES[0].key}>
          <TabsList className="grid w-full grid-cols-3">
            {LANES.map((lane) => (
              <TabsTrigger key={lane.key} value={lane.key} className="gap-1.5 text-[12px]">
                <span className="truncate">{lane.label}</span>
                {groups[lane.key].length > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                    {groups[lane.key].length}
                  </Badge>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {LANES.map((lane) => {
            const items = groups[lane.key]
            return (
              <TabsContent key={lane.key} value={lane.key} className="mt-3">
                {items.length === 0 ? (
                  <Empty className="gap-2 rounded-md border p-6">
                    <EmptyHeader className="gap-1">
                      <EmptyMedia variant="icon">
                        <HugeiconsIcon icon={lane.icon} size={20} aria-hidden />
                      </EmptyMedia>
                      <EmptyTitle className="text-sm">{lane.title}</EmptyTitle>
                      <EmptyDescription className="text-xs">{lane.description}</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <>
                    <p className="mb-2 text-[11px] text-muted-foreground">{lane.note}</p>
                    <ul className="flex flex-col divide-y rounded-md border">
                      {items.map((t) => (
                        <li key={t.id}>
                          <Link
                            href={`/tasks/${t.id}`}
                            className="flex min-h-11 items-center gap-3 px-3 py-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          >
                            <span className="min-w-0 flex-1 truncate text-[13px]">{t.name}</span>
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {t.ownerName}
                            </Badge>
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {formatDistanceToNow(new Date(t.since), { addSuffix: true, locale: ko })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      </CardContent>
    </Card>
  )
}
