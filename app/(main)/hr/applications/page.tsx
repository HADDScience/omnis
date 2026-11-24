import type { Metadata } from "next"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { Header } from "@/components/layout/header"
import { NotReviewer } from "@/components/hr/not-reviewer"
import { auth } from "@/lib/auth"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { listApplications, type ApplicationRow } from "@/lib/hr/queries"
import { STAGE_LABEL, interestLabel } from "@/lib/hr/rules"
import { cn } from "@/lib/utils"

export const metadata: Metadata = { title: "지원서함" }
export const dynamic = "force-dynamic"

const SECTION = "glass rounded-2xl p-4"
const dateFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

/**
 * 채용 지원서함 — 홈페이지 Career 탭에서 들어온 지원서. 채용 담당만(lib/hr/reviewers.ts).
 * 목록에는 이름 · 학과 · 학년 · 접수 시각만 — 연락처 · 지원 동기 · 파일은 상세에서 연다(열 때 기록이 남는다).
 * 1단계는 접수 창구까지다. 단계 바꾸기 · 선발 종료 · 지금 파기는 2단계(mydocs/plans/2026-11-24-hr-intake.md).
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

  const rows = await listApplications()
  const jobs = new Map<string, { title: string; rows: ApplicationRow[] }>()
  for (const r of rows) {
    const j = jobs.get(r.jobSlug) ?? { title: r.jobTitle, rows: [] }
    j.rows.push(r)
    jobs.set(r.jobSlug, j)
  }

  return (
    <>
      <Header crumbs={["채용", "지원서함"]} />
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4 px-4 py-6 sm:px-6" data-hr-applications>
        {rows.length === 0 ? (
          <section className={SECTION}>
            <h1 className="text-base font-semibold">지원서함</h1>
            <p className="mt-2 text-sm text-muted-foreground">아직 접수된 지원서가 없습니다. 홈페이지 채용 공고에서 지원서를 내면 여기에 쌓이고, 채용 담당에게 알림이 갑니다.</p>
          </section>
        ) : (
          [...jobs.entries()].map(([slug, j]) => (
            <section key={slug} aria-labelledby={`job-${slug}`} className={SECTION} data-hr-job={slug}>
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`job-${slug}`} className="min-w-0 text-base font-semibold break-keep">{j.title}</h2>
                <p className="text-[12.5px] text-muted-foreground tabular-nums">
                  {j.rows.length}건 · 새로 접수 {j.rows.filter((r) => r.stage === "RECEIVED").length}
                </p>
              </div>
              <ul className="flex flex-col gap-1">
                {j.rows.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/hr/applications/${r.id}`}
                      data-hr-application={r.code ?? r.id}
                      className="touch-target flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          "glass-pill shrink-0 rounded-full px-2.5 py-0.5 text-[12px]",
                          r.stage === "RECEIVED" ? "font-semibold text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {STAGE_LABEL[r.stage]}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col leading-tight">
                        <span className="truncate text-sm font-medium">{r.purgedAt ? "(보관 기간이 지나 파기됨)" : r.name}</span>
                        <span className="truncate text-[12px] text-muted-foreground">
                          {r.code} {r.purgedAt ? "" : `· ${r.department ?? ""} · ${r.grade ?? ""}학년`}
                        </span>
                        {!r.purgedAt && r.interests.length > 0 && (
                          <span className="truncate text-[12px] text-muted-foreground" data-hr-interests>
                            관심: {r.interests.map((v) => interestLabel(v)).join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{r.receivedAt ? dateFmt.format(r.receivedAt) : ""}</span>
                      <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        <p className="px-1 text-[12px] text-muted-foreground">
          지원서는 선발 종료 6개월 뒤(늦어도 접수 12개월 뒤) 개인정보와 파일이 저절로 지워집니다. 볼 수 있는 사람은 관리자 › 운영 › 채용 담당에서 정합니다.
        </p>
      </div>
    </>
  )
}
