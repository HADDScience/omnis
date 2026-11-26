import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download04Icon } from "@hugeicons/core-free-icons"

import { Header } from "@/components/layout/header"
import { NotReviewer } from "@/components/hr/not-reviewer"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { apiUrl } from "@/lib/base-path"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { getApplication } from "@/lib/hr/queries"
import { SLOT_LABEL, STAGE_LABEL, interestLabel, purgeDeadline, slotParam } from "@/lib/hr/rules"
import { canPack } from "@/lib/hr/stage-label"

export const metadata: Metadata = { title: "지원서" }
export const dynamic = "force-dynamic"

const SECTION = "glass rounded-2xl p-4"
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" })
const dateOnly = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" })
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`

interface Props {
  params: Promise<{ id: string }>
}

/**
 * 지원서 한 장 — 채용 담당만. 열 때마다 누가 · 언제 열었는지 활동 기록에 남긴다(파일 내려받기도 따로 남는다).
 * 서버에서 그리고 캐시하지 않는다(force-dynamic) — 캐시되면 기록 없이 열린다.
 */
export default async function HrApplicationPage({ params }: Props) {
  const session = await auth()
  if (!(await isHrReviewer(session?.user?.id))) {
    return (
      <>
        <Header crumbs={["채용", "지원서"]} />
        <NotReviewer />
      </>
    )
  }
  const { id } = await params
  const app = await getApplication(id)
  if (!app) notFound()

  await writeActivity({
    userId: session!.user!.id,
    action: "hr.application.viewed",
    entity: "job_application",
    entityId: app.id,
    title: `지원서 열람: ${app.code ?? app.id}`,
  })

  const purged = !!app.purgedAt
  const deadline = purgeDeadline(app)
  const fields: [string, string | null][] = [
    ["이름", app.name],
    ["학과", app.department],
    ["학번", app.studentId],
    ["학년", app.grade ? `${app.grade}학년` : null],
    ["졸업 예정", app.graduation],
    ["연락처", app.phone],
    ["이메일", app.email],
    ["포트폴리오 링크", app.portfolioUrl],
    ["관심 있는 일", app.interests.length ? app.interests.map((v) => interestLabel(v)).join(" · ") : null],
  ]

  return (
    <>
      <Header crumbs={["채용", "지원서함", app.code ?? "지원서"]} />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-4 py-6 sm:px-6" data-hr-application-detail={app.code ?? app.id}>
        <section className={SECTION} aria-labelledby="hr-app-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 id="hr-app-title" className="min-w-0 text-base font-semibold break-keep">
              {purged ? "(파기된 지원서)" : app.name} <span className="text-[12.5px] font-normal text-muted-foreground">{app.code}</span>
            </h1>
            <span className="flex items-center gap-2">
              {!purged && canPack(app.stage) && (
                <a
                  href={apiUrl(`/api/hr/applications/${app.id}/interview-pack`)}
                  download
                  data-hr-interview-pack
                  className="glass-pill touch-target inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors hover:bg-foreground/[0.06]"
                >
                  <HugeiconsIcon icon={Download04Icon} size={14} strokeWidth={2} aria-hidden />
                  면접자료 PDF
                </a>
              )}
              <span className="glass-pill rounded-full px-2.5 py-0.5 text-[12px] font-medium" data-hr-stage={app.stage}>{STAGE_LABEL[app.stage]}</span>
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground break-keep">
            {app.jobTitle} · 접수 {app.receivedAt ? dateTime.format(app.receivedAt) : "-"} · {app.lang === "en" ? "영문" : "국문"} 페이지
          </p>
        </section>

        {purged ? (
          <section className={SECTION}>
            <p className="text-sm text-muted-foreground">
              보관 기간이 지나 {dateOnly.format(app.purgedAt!)}에 개인정보와 파일을 지웠습니다. 공고 · 단계 · 접수 시각만 남아 있습니다.
            </p>
          </section>
        ) : (
          <>
            <section className={SECTION} aria-labelledby="hr-app-fields">
              <h2 id="hr-app-fields" className="mb-3 text-[13px] font-semibold text-muted-foreground">지원자</h2>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                {fields.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-all">
                      {k === "포트폴리오 링크" && v ? (
                        <a href={v} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">{v}</a>
                      ) : (
                        v || <span className="text-muted-foreground">-</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className={SECTION} aria-labelledby="hr-app-motivation">
              <h2 id="hr-app-motivation" className="mb-2 text-[13px] font-semibold text-muted-foreground">지원 동기</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-keep">{app.motivation}</p>
            </section>

            <section className={SECTION} aria-labelledby="hr-app-files">
              <h2 id="hr-app-files" className="mb-2 text-[13px] font-semibold text-muted-foreground">파일</h2>
              <ul className="flex flex-col gap-1">
                {app.files.map((f) => (
                  <li key={f.id}>
                    <a
                      href={apiUrl(`/api/hr/applications/${app.id}/files/${slotParam(f.slot)}`)}
                      download
                      data-hr-file={slotParam(f.slot)}
                      className="touch-target flex items-center gap-3 rounded-xl px-2 py-2.5 text-sm transition-colors hover:bg-muted/60"
                    >
                      <HugeiconsIcon icon={Download04Icon} size={16} className="shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium">{SLOT_LABEL[f.slot]}</span>
                        <span className="ml-2 text-[12px] text-muted-foreground">{f.fileName} · {mb(f.size)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted-foreground">내려받을 때마다 기록이 남습니다. 내려받은 파일도 보관 기간이 지나면 지워 주세요.</p>
            </section>
          </>
        )}

        <section className={SECTION} aria-labelledby="hr-app-history">
          <h2 id="hr-app-history" className="mb-2 text-[13px] font-semibold text-muted-foreground">기록</h2>
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {app.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">{dateTime.format(e.createdAt)}</span>
                <span>{e.toStage ? STAGE_LABEL[e.toStage] : ""}{e.note ? ` ${e.note}` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">
            동의 {app.consentAt ? dateTime.format(app.consentAt) : "-"} ({app.consentVersion ?? "-"})
            {!purged && deadline ? ` · ${dateOnly.format(deadline)}에 저절로 파기됩니다` : ""}
          </p>
        </section>
      </div>
    </>
  )
}
