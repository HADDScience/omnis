import Link from "next/link"
import { notFound } from "next/navigation"

import { Header } from "@/components/layout/header"
import { InquiryReview } from "@/components/crm/inquiry-review"
import { prisma } from "@/lib/db"
import { INQUIRY_STATUS_LABEL, topicLabel } from "@/lib/website-inquiry-labels"

export const dynamic = "force-dynamic"

export default async function InquiryDetailPage({
  params,
}: {
  params: Promise<{ inquiryId: string }>
}) {
  const { inquiryId } = await params
  // 규칙 21 — 승인이 이은 1-hop(기관·담당자·견적)을 함께 읽는다
  const inquiry = await prisma.websiteInquiry.findUnique({
    where: { id: inquiryId },
    include: {
      org: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
      quote: { select: { id: true, code: true } },
    },
  })
  if (!inquiry) notFound()

  const reviewer = inquiry.reviewedById
    ? await prisma.user.findUnique({
        where: { id: inquiry.reviewedById },
        select: { name: true },
      })
    : null

  // 견적 작성 화면과 같은 모양으로 넘긴다(OrgLite). 기관 26곳 규모라 통째로 보내고
  // 화면에서 좁힌다 — 검색 엔드포인트를 따로 두는 것은 이 크기에서 얻는 것이 없다.
  const orgs =
    inquiry.status === "NEW"
      ? await prisma.crmOrg.findMany({
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            type: true,
            contacts: {
              orderBy: { name: "asc" },
              select: { id: true, name: true, title: true },
            },
            memberships: {
              where: { status: "ACTIVE" },
              select: { id: true, discountAmount: true },
              take: 1,
            },
          },
        })
      : []

  return (
    <>
      <Header crumbs={["CRM", "문의", inquiry.name]} />
      <div className="mx-auto w-full max-w-[760px] px-6 py-6">
        <div className="mb-4 flex flex-wrap items-baseline gap-2">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">{inquiry.name}</h1>
          {inquiry.organization && (
            <span className="text-[13px] text-muted-foreground">{inquiry.organization}</span>
          )}
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {topicLabel(inquiry.topic)}
          </span>
          <span className="ml-auto text-[12px] text-muted-foreground">
            {INQUIRY_STATUS_LABEL[inquiry.status]}
            {reviewer && ` · ${reviewer.name}`}
          </span>
        </div>

        {/* 받은 그대로 보여 준다. 다듬으면 스팸인지 사람인지 가리는 단서가 지워진다. */}
        <section className="rounded-xl border bg-card p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">이메일</dt>
            <dd className="break-all">
              <a href={`mailto:${inquiry.email}`} className="hover:underline">
                {inquiry.email}
              </a>
            </dd>
            <dt className="text-muted-foreground">연락처</dt>
            <dd>{inquiry.phone ?? "—"}</dd>
            <dt className="text-muted-foreground">접수</dt>
            <dd>
              {inquiry.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {inquiry.lang}
            </dd>
            <dt className="text-muted-foreground">IP</dt>
            <dd className="break-all font-mono text-[12px]">{inquiry.ip ?? "—"}</dd>
            <dt className="text-muted-foreground">브라우저</dt>
            <dd className="break-all text-[12px] text-muted-foreground">
              {inquiry.userAgent ?? "—"}
            </dd>
          </dl>
          <p className="mt-3 border-t pt-3 text-[14px] whitespace-pre-wrap">{inquiry.message}</p>
        </section>

        {inquiry.status === "NEW" ? (
          <InquiryReview
            inquiryId={inquiry.id}
            orgs={orgs.map(({ memberships, ...o }) => ({ ...o, membership: memberships[0] ?? null }))}
            suggestedOrgName={inquiry.organization ?? ""}
            contactName={inquiry.name}
            contactEmail={inquiry.email}
            contactPhone={inquiry.phone}
          />
        ) : (
          <section className="mt-4 rounded-xl border bg-card p-4 text-[13px]">
            <p className="font-semibold">{INQUIRY_STATUS_LABEL[inquiry.status]} 처리됨</p>
            {inquiry.reviewNote && (
              <p className="mt-1.5 whitespace-pre-wrap text-muted-foreground">
                {inquiry.reviewNote}
              </p>
            )}
            {inquiry.status === "ACCEPTED" && (
              <ul className="mt-2.5 flex flex-col gap-1">
                {inquiry.org && (
                  <li>
                    기관{" "}
                    <Link href={`/crm/orgs/${inquiry.org.id}`} className="hover:underline">
                      {inquiry.org.name}
                    </Link>
                  </li>
                )}
                {inquiry.contact && <li>담당자 {inquiry.contact.name}</li>}
                {inquiry.quote && (
                  <li>
                    견적{" "}
                    <Link href={`/crm/quotes/${inquiry.quote.id}`} className="hover:underline">
                      {inquiry.quote.code}
                    </Link>{" "}
                    <span className="text-muted-foreground">— 품목을 채워 주세요</span>
                  </li>
                )}
                {/* 지워진 뒤에는 링크가 null 이다. status 는 남아 「승인했다」 는 사실을 지킨다 */}
                {!inquiry.org && !inquiry.quote && (
                  <li className="text-muted-foreground">이어졌던 기관·견적이 지워졌습니다.</li>
                )}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  )
}
