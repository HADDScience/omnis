import Link from "next/link"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { ProjectMerge, type MergeableProject } from "./project-merge"

export const dynamic = "force-dynamic"

/**
 * 프로젝트 정리는 업무의 일이다.
 *
 * 원래 /settings 에 있었는데, 거기는 내 프로필·연결 계정을 보는 자리라
 * 「내 것」과 「모두의 업무 데이터」가 한 화면에 섞여 있었다. 프로젝트를 합치면
 * 남의 업무도 같이 옮겨간다 — 개인 설정이 아니라 업무 공간의 정리 작업이므로
 * /tasks 아래로 옮긴다. (사용자 요청, 2026-09-09)
 */
export default async function TaskProjectsPage() {
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
      <Header
        crumbs={["업무", "프로젝트 정리"]}
        actions={
          <Link
            href="/tasks"
            className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-muted hover:text-foreground"
          >
            업무로
          </Link>
        }
      />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">
        <ProjectMerge projects={mergeable} />
      </div>
    </>
  )
}
