import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { ReportList } from "./report-list"

export const dynamic = "force-dynamic"

export default async function ReportsPage() {
  const reports = await prisma.weeklyReport.findMany({
    orderBy: { weekStart: "desc" },
    include: { owner: { select: { id: true, name: true } } },
  })

  const serialized = reports.map((r) => ({
    ...r,
    weekStart: r.weekStart.toISOString(),
    weekEnd: r.weekEnd.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))

  return (
    <>
      <Header title="주간보고" />
      <ReportList reports={serialized} />
    </>
  )
}
