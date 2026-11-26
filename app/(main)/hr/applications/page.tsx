import type { Metadata } from "next"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { Header } from "@/components/layout/header"
import { NotReviewer } from "@/components/hr/not-reviewer"
import { auth } from "@/lib/auth"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { applicationCounts } from "@/lib/hr/queries"
import { BOARD_COLUMNS, columnOf, groupJobs, loadJobs, type BoardColumnKey, type JobGroup } from "@/lib/hr/jobs"
import { closesLabel } from "@/lib/hr/format"

export const metadata: Metadata = { title: "지원서함" }
export const dynamic = "force-dynamic"

/**
 * 채용 지원서함 — 공고 목록. 채용 담당만(lib/hr/reviewers.ts).
 * 열린 공고(마감 전)를 위에, 마감된 공고는 아래 접힌 묶음. 공고를 누르면 보드(jobs/[slug]).
 * 마감 · 공고 이름은 홈페이지 공고(lib/hr/jobs.ts), 인원은 지원서(올리는 중 제외)에서 센다.
 */
export default async function HrApplicationsPage() {
  const session = await auth()
  if (!(await isHrReviewer(session?.user?.id))) {
    return (
      <>
        <Header crumbs={["채용", "지원서함"]} />
        <NotReviewer />
      </>
    )
  }

  const [counts, jobs] = await Promise.all([applicationCounts(), loadJobs()])
  const tally = new Map<string, Record<BoardColumnKey, number>>()
  const titles = new Map<string, string>()
  for (const c of counts) {
    titles.set(c.jobSlug, c.jobTitle)
    const t = tally.get(c.jobSlug) ?? { received: 0, passed: 0, hired: 0, out: 0 }
    const col = columnOf(c.stage)
    if (col) t[col] += c.count
    tally.set(c.jobSlug, t)
  }
  const { open, closed } = groupJobs(jobs, [...titles].map(([slug, title]) => ({ slug, title })))

  return (
    <>
      <Header crumbs={["채용", "지원서함"]} />
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-3 px-4 py-6 sm:px-6" data-hr-applications>
        {open.length === 0 && closed.length === 0 && (
          <p className="glass rounded-2xl p-4 text-sm text-muted-foreground">공고가 없습니다.</p>
        )}
        {open.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="열린 공고">
            {open.map((j) => (
              <JobCard key={j.slug} job={j} tally={tally.get(j.slug)} />
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="group mt-2" data-hr-closed-jobs>
            <summary className="touch-target flex cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
              마감된 공고 <span className="tabular-nums">{closed.length}</span>
              <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} aria-hidden className="transition-transform group-open:rotate-180" />
            </summary>
            <ul className="mt-2 flex flex-col gap-2" aria-label="마감된 공고">
              {closed.map((j) => (
                <JobCard key={j.slug} job={j} tally={tally.get(j.slug)} />
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  )
}

function JobCard({ job, tally }: { job: JobGroup; tally?: Record<BoardColumnKey, number> }) {
  const t = tally ?? { received: 0, passed: 0, hired: 0, out: 0 }
  return (
    <li>
      <Link
        href={`/hr/applications/jobs/${job.slug}`}
        data-hr-job={job.slug}
        className="glass touch-target flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-colors hover:bg-foreground/[0.03]"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[15px] font-semibold break-keep">{job.title}</span>
          <span className="text-[12.5px] text-muted-foreground tabular-nums">{closesLabel(job.closesAt)}</span>
          <span className="mt-1 flex flex-wrap gap-1.5 text-[12px]" data-hr-job-counts>
            {BOARD_COLUMNS.map((c) => (
              <span key={c.key} className="glass-pill rounded-full px-2.5 py-0.5">
                {c.label} <span className="font-semibold tabular-nums">{t[c.key]}</span>
              </span>
            ))}
            {t.out > 0 && (
              <span className="rounded-full px-2 py-0.5 text-muted-foreground">
                불합격·철회 <span className="tabular-nums">{t.out}</span>
              </span>
            )}
          </span>
        </span>
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  )
}
