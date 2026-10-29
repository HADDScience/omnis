import { Header } from "@/components/layout/header"
import { InstallAppCard } from "@/components/layout/install-app-card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AiUsage } from "@/components/settings/ai-usage"
import { LinkedAccounts } from "@/components/settings/linked-accounts"
import { MyShortcuts } from "@/components/settings/my-shortcuts"
import { PushNotifications } from "@/components/settings/push-notifications"
import { NotificationKinds } from "@/components/settings/notification-kinds"
import { auth } from "@/lib/auth"

export const dynamic = "force-dynamic"

/**
 * 마이 탭 — 내 계정을 보는 자리다. 프로젝트 정리(병합)는 남의 업무까지 옮기는
 * 작업이라 개인 설정이 아니다 — /tasks/projects 로 옮겼다. (2026-09-09)
 *
 * 사이드바를 걷으면서(2026-10-28) 프로필 메뉴에 있던 MCP 등록·튜토리얼·테마·로그아웃이 여기로 왔다.
 * 카드를 세로로 셋 넘게 쌓지 않으려고(규칙 17) 설정 카드들은 탭으로 묶는다.
 */
export default async function SettingsPage() {
  const session = await auth()
  const user = session?.user
  const role = (user as { role?: string } | undefined)?.role ?? "MEMBER"

  return (
    <>
      <Header title="마이" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center gap-3 px-1">
          <Avatar className="size-12">
            <AvatarFallback className="text-base font-semibold">{user?.name?.charAt(0) ?? "?"}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[15px] font-semibold">{user?.name ?? "사용자"}</span>
            {user?.email && (
              <span className="truncate text-[12px] text-muted-foreground">{user.email}</span>
            )}
            <span className="font-mono text-[10.5px] text-muted-foreground">{role}</span>
          </div>
        </div>

        <InstallAppCard />

        <MyShortcuts />

        <Tabs defaultValue="push">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="push">기기 알림</TabsTrigger>
            <TabsTrigger value="accounts">연결된 계정</TabsTrigger>
            <TabsTrigger value="ai">AI 사용량</TabsTrigger>
            <TabsTrigger value="system">시스템</TabsTrigger>
          </TabsList>
          <TabsContent value="push" className="mt-3 flex flex-col gap-4">
            <PushNotifications />
            <NotificationKinds />
          </TabsContent>
          <TabsContent value="accounts" className="mt-3">
            <LinkedAccounts />
          </TabsContent>
          <TabsContent value="ai" className="mt-3">
            <AiUsage />
          </TabsContent>
          <TabsContent value="system" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">시스템 설정</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  사용자 관리, Gemini API 키, 시스템 설정을 관리합니다.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
