import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { ProposalList } from "@/components/omnis/proposal-list"
import { RecordProposalList } from "@/components/company/record-proposal-list"

export const metadata: Metadata = {
  title: "AI 제안 · Omnis",
}

export const dynamic = "force-dynamic"

interface Props {
  searchParams: Promise<{ tab?: string }>
}

/**
 * AI 가 올린 제안 — 지식 카드 갱신과 연혁 후보.
 * 둘은 판단하는 것이 달라(카드 본문 vs 연혁 한 줄) 탭마다 다른 컴포넌트를 쓴다.
 */
export default async function ProposalsPage({ searchParams }: Props) {
  const { tab } = await searchParams
  const records = tab === "records"

  return (
    <>
      <Header crumbs={["HADD DB", "AI 제안"]} />
      <div className="mx-auto w-full max-w-[760px] px-4 py-6">
        <h1 className="text-[19px] font-semibold">AI 제안</h1>
        <nav aria-label="제안 종류" className="mt-3 mb-4 flex gap-1.5">
          <Link
            href="/omnis/proposals"
            aria-current={!records ? "page" : undefined}
            className={`touch-target rounded-full border px-3 py-1 text-[12.5px] ${!records ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            지식 카드
          </Link>
          <Link
            href="/omnis/proposals?tab=records"
            aria-current={records ? "page" : undefined}
            className={`touch-target rounded-full border px-3 py-1 text-[12.5px] ${records ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
          >
            연혁
          </Link>
        </nav>
        <p className="mb-5 text-[13px] text-muted-foreground">
          {records
            ? "채팅과 업무에서 AI 가 회사 연혁 후보를 찾았습니다. 채택하면 연혁·실적에 한 줄이 생깁니다."
            : "업무가 완료되면 AI 가 그 대화에서 회사에 남을 지식을 찾아 카드 갱신을 제안합니다. 수락·거절이 쌓이면 자동 반영으로 넘어갑니다."}
        </p>
        {records ? <RecordProposalList /> : <ProposalList />}
      </div>
    </>
  )
}
