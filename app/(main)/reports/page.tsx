import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { ReportList } from "./report-list"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function ReportsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const reports = await prisma.weeklyReport.findMany({
    where: { ownerId: session.user.id },
    orderBy: { weekStart: "desc" },
    include: { owner: { select: { id: true, name: true } } },
  })

  const serialized = reports.map((r) => ({
    ...r,
    weekStart: r.weekStart.toISOString(),
    weekEnd: r.weekEnd.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null,
  }))

  return (
    <>
      <Header title="주간보고" />
      <ReportList reports={serialized} />
    </>
  )
}
