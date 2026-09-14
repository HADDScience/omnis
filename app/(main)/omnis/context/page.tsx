import type { Metadata } from "next"
import { Header } from "@/components/layout/header"
import { ContextGraph } from "@/components/omnis/context-graph"
import { auth } from "@/lib/auth"
import { loadNeighborhood, searchContext } from "@/lib/context-graph"

export const metadata: Metadata = { title: "Context · HADD DB" }
export const dynamic = "force-dynamic"

interface Props {
  searchParams: Promise<{ node?: string }>
}

/**
 * Context 그래프 — 옴니스 DB 를 대상 하나씩 가운데 두고 펼쳐 본다.
 * 실선은 외래키, 점선은 임베딩 거리. LLM 을 부르지 않는다.
 */
export default async function ContextPage({ searchParams }: Props) {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"
  const { node } = await searchParams
  const [initial, suggestions] = await Promise.all([
    node ? loadNeighborhood(node, { isAdmin }) : Promise.resolve(null),
    searchContext(""),
  ])

  return (
    <>
      <Header crumbs={["HADD DB", "Context"]} />
      <div className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">Context</h1>
          <span className="text-[13px] text-muted-foreground">
            DB 로 이어진 것은 실선, AI 임베딩이 가깝다고 보는 것은 점선 · 이웃을 누르면 그쪽이 가운데가 된다
          </span>
        </div>
        <ContextGraph initial={initial} suggestions={suggestions} missing={!!node && !initial} />
      </div>
    </>
  )
}
