import { Header } from "@/components/layout/header"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkedAccounts } from "@/components/settings/linked-accounts"
import { prisma } from "@/lib/db"
import { ProjectMerge, type MergeableProject } from "./project-merge"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const projects = await prisma.project.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      product: { select: { name: true } },
      _count: { select: { tasks: { where: { archived: false } } } },
    },
  })

  const mergeable: MergeableProject[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    productName: p.product?.name ?? null,
    taskCount: p._count.tasks,
  }))

  return (
    <>
      <Header title="설정" />
      <div className="flex flex-1 flex-col gap-4 p-4">
        <ProjectMerge projects={mergeable} />

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
