import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { Header } from "@/components/layout/header"
import { AiSurvey } from "@/components/survey/ai-survey"
import { getSurvey } from "@/lib/ai-survey/service"
import { auth } from "@/lib/auth"

export const metadata: Metadata = { title: "AI 활용 설문" }
export const dynamic = "force-dynamic"

/** AI 활용 설문 — 구성원 누구나 자기 것 하나. 답하던 곳에서 이어진다 */
export default async function AiSurveyPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const state = await getSurvey(session.user.id)
  return (
    <>
      <Header crumbs={["마이", "AI 활용 설문"]} />
      <div className="mx-auto w-full max-w-[640px] px-4 py-6 sm:px-6">
        <AiSurvey initial={state} />
      </div>
    </>
  )
}
