import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkedAccounts } from "@/components/settings/linked-accounts"

export const dynamic = "force-dynamic"

/**
 * 여기는 내 계정을 보는 자리다. 프로젝트 정리(병합)는 남의 업무까지 옮기는
 * 작업이라 개인 설정이 아니다 — /tasks/projects 로 옮겼다. (2026-09-09)
 */
export default async function SettingsPage() {
  return (
    <>
      <Header title="설정" />
      <div className="flex flex-1 flex-col gap-4 p-4">
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

        <LinkedAccounts />
      </div>
    </>
  )
}
