"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { DashboardStalled, type StalledGroups } from "./dashboard-stalled"
import { DashboardMembers, type MemberStat } from "./dashboard-members"
import { DashboardLists } from "./dashboard-lists"

export interface TasksOverviewSheetProps {
  stalledGroups: StalledGroups
  userStats: MemberStat[]
  gajumMarkdown: string
  gwajaeMarkdown: string
}

/**
 * 현황 띠 「상세 ›」 가 여는 시트 본문 — 예전 워크스페이스 화면의 카드들.
 * 카드 셋을 세로로 쌓으면 규칙 17 이라 탭으로 나눈다. 각 탭은 이미 서로 다른 컴포넌트다(규칙 25).
 */
export function TasksOverviewSheet({
  stalledGroups,
  userStats,
  gajumMarkdown,
  gwajaeMarkdown,
}: TasksOverviewSheetProps) {
  const hasLists = Boolean(gajumMarkdown || gwajaeMarkdown)

  return (
    <Tabs defaultValue="stalled" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 grid shrink-0 grid-cols-3">
        <TabsTrigger value="stalled">멈춘 업무</TabsTrigger>
        <TabsTrigger value="members">팀원별</TabsTrigger>
        <TabsTrigger value="lists">과제·가점</TabsTrigger>
      </TabsList>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <TabsContent value="stalled" className="mt-3">
          <DashboardStalled groups={stalledGroups} />
        </TabsContent>
        <TabsContent value="members" className="mt-3">
          {userStats.length > 0 ? (
            <DashboardMembers members={userStats} />
          ) : (
            <Empty className="rounded-md border p-6">
              <EmptyHeader>
                <EmptyTitle className="text-sm">담당자가 정해진 업무가 없습니다</EmptyTitle>
                <EmptyDescription className="text-xs">
                  업무에 담당자를 정하면 사람별 진행 현황이 여기 모입니다.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="lists" className="mt-3">
          {hasLists ? (
            <DashboardLists gajumMarkdown={gajumMarkdown} gwajaeMarkdown={gwajaeMarkdown} />
          ) : (
            <Empty className="rounded-md border p-6">
              <EmptyHeader>
                <EmptyTitle className="text-sm">과제·가점항목 리스트가 없습니다</EmptyTitle>
                <EmptyDescription className="text-xs">
                  HADD DB 에 「과제 리스트」·「가점항목 리스트」 카드를 만들면 여기 표로 보입니다.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </TabsContent>
      </div>
    </Tabs>
  )
}
