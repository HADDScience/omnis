import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { ReportDetail } from "./report-detail"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"

interface Props {
  params: Promise<{ reportId: string }>
}

export default async function ReportDetailPage({ params }: Props) {
  const { reportId } = await params
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const report = await prisma.weeklyReport.findFirst({
    where: { id: reportId, ownerId: session.user.id },
    include: { owner: { select: { id: true, name: true } } },
  })

  if (!report) notFound()

  return (
    <>
      <Header title={report.title} />
      <ReportDetail
        report={{
          ...report,
          weekStart: report.weekStart.toISOString(),
          weekEnd: report.weekEnd.toISOString(),
          createdAt: report.createdAt.toISOString(),
          updatedAt: report.updatedAt.toISOString(),
          submittedAt: report.submittedAt?.toISOString() ?? null,
        }}
      />
    </>
  )
}
