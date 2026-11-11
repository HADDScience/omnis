import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { SurveyResultsView } from "@/components/survey/survey-results"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { loadSurveyResults } from "@/lib/ai-survey/results"
import { auth } from "@/lib/auth"

export const metadata: Metadata = { title: "AI 활용 설문 결과" }
export const dynamic = "force-dynamic"

/** 설문 결과 — 회사 전체 AI 사용량 추정 · 사람별 원문. 관리자만(원문은 본인과 관리자만 본다) */
export default async function AiSurveyResultsPage() {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!session?.user?.id || !isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "AI 활용 설문 결과"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>내 설문은 마이 → 사용량 → AI 활용 설문에서 볼 수 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  const results = await loadSurveyResults()
  return (
    <>
      <Header crumbs={["마이", "AI 활용 설문 결과"]} />
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
        <SurveyResultsView results={results} />
      </div>
    </>
  )
}
