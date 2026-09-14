import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { prisma } from "@/lib/db"

export const metadata: Metadata = { title: "시장기업 · HADD DB" }
export const dynamic = "force-dynamic"

interface Props {
  searchParams: Promise<{ segment?: string }>
}

/**
 * 시장 · 경쟁 기업. 거래처(CRM 기관)와 따로 둔다 — 섞으면 「거래 기관 N곳」 이 부풀려진다.
 * 금액 · 업력 · 규모는 원문 글자 그대로다(표기가 제각각).
 */
export default async function MarketPage({ searchParams }: Props) {
  const { segment } = await searchParams
  const [companies, segments] = await Promise.all([
    prisma.marketCompany.findMany({
      where: segment ? { segment } : {},
      orderBy: [{ segment: "asc" }, { name: "asc" }],
    }),
    prisma.marketCompany.groupBy({ by: ["segment"], _count: true, orderBy: { _count: { segment: "desc" } } }),
  ])
  const total = segments.reduce((a, s) => a + s._count, 0)
  const detailed = (c: (typeof companies)[number]) => [c.products, c.industry, c.ceo, c.foundedRaw, c.revenueRaw].filter(Boolean).length >= 2

  return (
    <>
      <Header crumbs={["HADD DB", "시장기업"]} />
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">시장기업</h1>
          <span className="text-[13px] text-muted-foreground">
            {total}곳 · 3D 오가노이드 · 배양 소재 관련 · 거래처는 CRM 에서 본다
          </span>
        </div>

        <nav aria-label="분류" className="mb-5 flex flex-wrap gap-1.5">
          <Link href="/omnis/market" className={chip(!segment)}>
            전체 · {total}
          </Link>
          {segments.map((s) =>
            s.segment ? (
              <Link key={s.segment} href={`/omnis/market?segment=${encodeURIComponent(s.segment)}`} className={chip(segment === s.segment)}>
                {s.segment} · {s._count}
              </Link>
            ) : null
          )}
        </nav>

        {companies.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>{segment ? "이 분류에 기업이 없습니다" : "시장기업이 아직 없습니다"}</EmptyTitle>
              <EmptyDescription>
                {segment ? (
                  <Link href="/omnis/market" className="underline">
                    전체 보기
                  </Link>
                ) : (
                  "노션 「타 업체 정보」 를 이식하면 여기에 보입니다."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {companies.map((c) => (
              <li key={c.id} className="rounded-lg border bg-card px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words text-[13.5px] font-medium">{c.name}</span>
                  {c.segment && <Badge variant="outline">{c.segment}</Badge>}
                  {c.country && <Badge variant="secondary">{c.country}</Badge>}
                  {c.animalAlternative === true && <Badge>동물대체시험법</Badge>}
                  {c.homepage && (
                    <a href={c.homepage} target="_blank" rel="noopener noreferrer" className="ml-auto text-[12px] text-muted-foreground hover:underline">
                      홈페이지
                    </a>
                  )}
                </div>
                {detailed(c) ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                    {c.products && <span className="break-words">주력 · {c.products}</span>}
                    {c.industry && <span>{c.industry}</span>}
                    {c.ceo && <span>대표 {c.ceo}</span>}
                    {c.foundedRaw && <span>설립 {c.foundedRaw}</span>}
                    {c.revenueRaw && <span>매출 {c.revenueRaw}</span>}
                    {c.capitalRaw && <span>자본금 {c.capitalRaw}</span>}
                    {c.headcountRaw && <span>{c.headcountRaw}</span>}
                  </div>
                ) : (
                  <p className="mt-1 text-[11.5px] text-muted-foreground">이름만 있다 — 조사가 더 필요하다</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

function chip(active: boolean) {
  return `touch-target rounded-full border px-3 py-1 text-[12px] transition-colors hover:border-border-strong ${
    active ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
  }`
}
