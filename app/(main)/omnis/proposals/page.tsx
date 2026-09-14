import type { Metadata } from "next"
import { Header } from "@/components/layout/header"
import { ProposalList } from "@/components/omnis/proposal-list"

export const metadata: Metadata = {
  title: "AI 카드 제안 · Omnis",
}

export const dynamic = "force-dynamic"

export default function ProposalsPage() {
  return (
    <>
      <Header crumbs={["HADD DB", "AI 카드 제안"]} />
      <div className="mx-auto w-full max-w-[760px] px-4 py-6">
        <h1 className="text-[19px] font-semibold">AI 카드 제안</h1>
        <p className="mt-1 mb-5 text-[13px] text-muted-foreground">
          업무가 완료되면 AI 가 그 대화에서 회사에 남을 지식을 찾아 카드 갱신을 제안합니다. 수락·거절이 쌓이면 자동 반영으로 넘어갑니다.
        </p>
        <ProposalList />
      </div>
    </>
  )
}
