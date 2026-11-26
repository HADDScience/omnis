import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { Header } from "@/components/layout/header"
import { NotReviewer } from "@/components/hr/not-reviewer"
import { ApplicationBoard, type BoardCard } from "@/components/hr/application-board"
import { auth } from "@/lib/auth"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { listApplications } from "@/lib/hr/queries"
import { loadJobs } from "@/lib/hr/jobs"
import { closesLabel } from "@/lib/hr/format"

export const metadata: Metadata = { title: "지원서함" }
export const dynamic = "force-dynamic"

interface Props {
  params: Promise<{ slug: string }>
}

/** 공고 하나의 보드 — 접수 · 서류 합격 · 최종 합격, 아래에 접힌 불합격·철회. 채용 담당만 */
export default async function HrJobBoardPage({ params }: Props) {
  const session = await auth()
  if (!(await isHrReviewer(session?.user?.id))) {
    return (
      <>
        <Header crumbs={["채용", "지원서함"]} />
        <NotReviewer />
      </>
    )
  }
  const { slug } = await params
  if (!/^[a-z0-9-]{3,100}$/.test(slug)) notFound()
  const [rows, jobs] = await Promise.all([listApplications({ jobSlug: slug, take: 500 }), loadJobs()])
  const job = jobs.find((j) => j.slug === slug)
  if (!job && rows.length === 0) notFound()
  const title = job?.title ?? rows[0].jobTitle

  const cards: BoardCard[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    stage: r.stage,
    name: r.purgedAt ? null : r.name,
    department: r.purgedAt ? null : r.department,
    grade: r.purgedAt ? null : r.grade,
    receivedAt: r.receivedAt?.toISOString() ?? null,
    fileCount: r.purgedAt ? 0 : r.fileCount,
    purged: !!r.purgedAt,
  }))

  return (
    <>
      <Header crumbs={["채용", "지원서함", title]} />
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-6 sm:px-6" data-hr-board={slug}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
          <h1 className="min-w-0 text-base font-semibold break-keep">{title}</h1>
          <p className="text-[12.5px] text-muted-foreground tabular-nums">{closesLabel(job?.closesAt ?? null)}</p>
        </div>
        <ApplicationBoard cards={cards} />
      </div>
    </>
  )
}
