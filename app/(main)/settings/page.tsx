import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SettingsPage() {
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
      </div>
    </>
  )
}
