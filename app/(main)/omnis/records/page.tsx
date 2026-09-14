import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/layout/header"
import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { prisma } from "@/lib/db"
import { won } from "@/lib/crm"
import { RECORD_KIND_LABEL, compactWon, periodText } from "@/lib/company-context"
import type { Prisma, RecordKind } from "@/generated/prisma/client"

export const metadata: Metadata = { title: "연혁·실적 · HADD DB" }
export const dynamic = "force-dynamic"

interface Props {
  searchParams: Promise<{ kind?: string; q?: string }>
}

const KINDS = Object.keys(RECORD_KIND_LABEL) as RecordKind[]

/**
 * 회사 연혁 · 실적. 연혁 표를 뼈대로, 지원사업 · 수상 · 학회 시트의 상세 칸이 붙어 있다.
 * 날짜가 다르면 상세 시트가 정본(2026-09-10 결정). 특허 · 상표는 지식재산권에서 본다.
 */
export default async function RecordsPage({ searchParams }: Props) {
  const { kind: kindParam, q: qParam } = await searchParams
  const kind = KINDS.includes(kindParam as RecordKind) ? (kindParam as RecordKind) : null
  const q = qParam?.trim() || null

  const where: Prisma.CompanyRecordWhereInput = {
    ...(kind ? { kind } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { organizer: { contains: q, mode: "insensitive" } },
            { subject: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  }

  const [records, byKind, grants] = await Promise.all([
    prisma.companyRecord.findMany({
      where,
      orderBy: [{ startsOn: { sort: "desc", nulls: "last" } }, { title: "asc" }],
      include: { project: { select: { id: true, name: true } } },
    }),
    prisma.companyRecord.groupBy({ by: ["kind"], _count: true }),
    prisma.companyRecord.aggregate({ where: { kind: "GRANT", source: "지원사업" }, _sum: { fundingKrw: true }, _count: true }),
  ])
  const total = byKind.reduce((a, k) => a + k._count, 0)

  const groups = new Map<string, typeof records>()
  for (const r of records) {
    const y = r.startsOn ? String(r.startsOn.getUTCFullYear()) : "날짜 없음"
    groups.set(y, [...(groups.get(y) ?? []), r])
  }

  const href = (next: { kind?: RecordKind | null; q?: string | null }) => {
    const p = new URLSearchParams()
    const k = next.kind === undefined ? kind : next.kind
    const s = next.q === undefined ? q : next.q
    if (k) p.set("kind", k)
    if (s) p.set("q", s)
    const qs = p.toString()
    return `/omnis/records${qs ? `?${qs}` : ""}`
  }

  return (
    <>
      <Header crumbs={["HADD DB", "연혁·실적"]} />
      <div className="mx-auto w-full max-w-[960px] px-4 py-6 sm:px-6">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">연혁·실적</h1>
          <span className="text-[13px] text-muted-foreground">
            {total}건 · 지원사업 {grants._count}건 · 지원금 합계 {compactWon(Number(grants._sum.fundingKrw ?? 0))}
          </span>
        </div>

        <form action="/omnis/records" className="mb-3 flex gap-2" role="search">
          {kind && <input type="hidden" name="kind" value={kind} />}
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="제목 · 기관 · 과제명으로 찾기"
            aria-label="연혁·실적 검색"
            className="touch-target min-w-0 flex-1 rounded-lg border bg-card px-3 py-2 text-[13px] outline-none focus:border-border-strong"
          />
        </form>

        <nav aria-label="종류" className="mb-5 flex flex-wrap gap-1.5">
          <Link href={href({ kind: null })} className={chip(kind === null)}>
            전체 · {total}
          </Link>
          {KINDS.map((k) => {
            const n = byKind.find((x) => x.kind === k)?._count ?? 0
            if (n === 0) return null
            return (
              <Link key={k} href={href({ kind: k })} className={chip(kind === k)}>
                {RECORD_KIND_LABEL[k]} · {n}
              </Link>
            )
          })}
        </nav>

        {records.length === 0 ? (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>{q || kind ? "조건에 맞는 기록이 없습니다" : "연혁·실적이 아직 없습니다"}</EmptyTitle>
              <EmptyDescription>
                {q || kind ? (
                  <Link href="/omnis/records" className="underline">
                    조건 지우기
                  </Link>
                ) : (
                  "연혁·지원사업 엑셀을 이식하면 여기에 쌓입니다."
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          [...groups.entries()].map(([year, items]) => (
            <section key={year} aria-labelledby={`y-${year}`} className="mb-6">
              <h2 id={`y-${year}`} className="mb-2 text-[13px] font-semibold text-muted-foreground">
                {year} · {items.length}건
              </h2>
              <ul className="flex flex-col gap-1.5">
                {items.map((r) => (
                  <li key={r.id} className="rounded-lg border bg-card px-3.5 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="outline">{RECORD_KIND_LABEL[r.kind]}</Badge>
                      <span className="min-w-0 break-words text-[13.5px] font-medium">{r.title}</span>
                      {r.status && <Badge variant={r.status === "진행중" || r.status === "계획" ? "default" : "secondary"}>{r.status}</Badge>}
                      <span className="ml-auto text-[11.5px] tabular-nums text-muted-foreground">{periodText(r)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
                      {r.organizer && <span>{r.organizer}</span>}
                      {r.partner && <span>대리점 {r.partner}</span>}
                      {r.venue && <span>{r.venue}</span>}
                      {r.prize && <span>{r.prize}</span>}
                      {r.subject && <span className="break-words">과제 · {r.subject}</span>}
                      {r.fundingKrw !== null && Number(r.fundingKrw) > 0 && <span>지원금 {won(Number(r.fundingKrw))}</span>}
                      {r.grantNo && <span>과제번호 {r.grantNo}</span>}
                      {r.project && (
                        <Link href="/tasks/projects" className="hover:underline">
                          업무 프로젝트 · {r.project.name}
                        </Link>
                      )}
                    </div>
                    {r.note && <p className="mt-1 break-words text-[11.5px] text-muted-foreground">{r.note}</p>}
                  </li>
                ))}
              </ul>
            </section>
          ))
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
