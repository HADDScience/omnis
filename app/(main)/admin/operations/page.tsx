import type { Metadata } from "next"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { FeatureRequestsSection } from "@/components/admin/feature-requests-section"
import { OnboardingSection } from "@/components/admin/onboarding-section"
import { requireAdminPage } from "@/lib/admin-access-server"
import { loadSurveyCounts } from "@/lib/admin-users-server"
import { surveyAllowed } from "@/lib/ai-survey/access"

export const metadata: Metadata = { title: "운영" }
export const dynamic = "force-dynamic"

const SECTION = "glass rounded-2xl p-4"

/** 옴니스 지식 화면 안의 관리자 기능(카드 편집 · 연결 · 인력 표) — 화면은 구성원과 같이 쓰므로 옮기지 않고 링크만 둔다 */
const KNOWLEDGE_LINKS = [
  { href: "/omnis", label: "옴니스 지식 카드" },
  { href: "/omnis/context", label: "연결 지도" },
  { href: "/omnis/staff", label: "인력" },
] as const

/** 운영 — 온보딩 다시 띄우기 · 기능 요청 · 설문 현황(응답 수만) */
export default async function AdminOperationsPage() {
  const adminId = await requireAdminPage()
  const survey = await loadSurveyCounts()
  const surveyOpen = surveyAllowed(adminId)

  return (
    <>
      <h1 className="sr-only">운영</h1>
      <OnboardingSection />

      <section aria-labelledby="admin-survey-title" className={SECTION} data-admin-survey>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="admin-survey-title" className="text-base font-semibold">AI 활용 설문</h2>
          {surveyOpen && (
            <Link href="/settings/ai-survey/results" data-ai-survey-results-link className="touch-target inline-flex items-center text-[12.5px] underline underline-offset-4">
              결과 보기
            </Link>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "제출", n: survey.submitted },
            { label: "확인 대기", n: survey.confirm },
            { label: "진행 중", n: survey.inProgress },
          ].map((s) => (
            <div key={s.label} className="glass-pill rounded-xl px-2 py-2.5">
              <dt className="text-[12px] text-muted-foreground">{s.label}</dt>
              <dd data-survey-count={s.label} className="text-lg font-semibold tabular-nums">{s.n}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12px] text-muted-foreground">응답 수만 보입니다. 사람별 응답은 관리자에게도 보이지 않습니다.</p>
      </section>

      <section aria-labelledby="admin-feature-title" className={SECTION} data-admin-feature-requests>
        <h2 id="admin-feature-title" className="mb-2 text-base font-semibold">기능 요청</h2>
        <FeatureRequestsSection />
      </section>

      <nav aria-label="옴니스 지식 관리" className={`${SECTION} flex flex-col gap-1`}>
        <h2 className="mb-1 text-base font-semibold">옴니스 지식 관리</h2>
        {KNOWLEDGE_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="touch-target flex items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60">
            {l.label}
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-muted-foreground" aria-hidden />
          </Link>
        ))}
      </nav>
    </>
  )
}
