import Link from "next/link"
import { notFound } from "next/navigation"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { quoteTotals, won, ORG_TYPE_LABEL, QUOTE_STATUS_LABEL, MEMBERSHIP_STATUS_LABEL } from "@/lib/crm"

export const dynamic = "force-dynamic"

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>
}) {
  const { orgId } = await params
  const org = await prisma.crmOrg.findUnique({
    where: { id: orgId },
    include: {
      contacts: { orderBy: { name: "asc" } },
      memberships: { include: { contact: true } },
      quotes: {
        orderBy: { quotedAt: "desc" },
        include: { items: { include: { product: true } }, contact: true },
      },
    },
  })
  if (!org) notFound()

  const revenue = org.quotes.reduce(
    (a, q) => a + quoteTotals(q.items, q.discountAmount, q.vatRate).total,
    0
  )

  return (
    <>
      <Header crumbs={["CRM", "기관", org.name]} />
      <div className="mx-auto w-full max-w-[900px] px-6 pb-20 pt-6">
        <div className="mb-5 flex flex-wrap items-baseline gap-2.5">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">{org.name}</h1>
          <Badge variant="outline">{ORG_TYPE_LABEL[org.type]}</Badge>
          <span className="font-mono text-[12px] text-muted-foreground">{org.code}</span>
          <span className="ml-auto text-[13px] text-muted-foreground">
            견적 {org.quotes.length}건 · {won(revenue)}
          </span>
        </div>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            담당자 {org.contacts.length}명
          </h2>
          {org.contacts.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">아직 등록된 담당자가 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {org.contacts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-baseline gap-2 border-b pb-2 last:border-0 last:pb-0">
                  <span className="text-[13px] font-medium">{c.name}</span>
                  {c.title && <span className="text-[12px] text-muted-foreground">{c.title}</span>}
                  {c.phone && <span className="text-[12px] text-muted-foreground">{c.phone}</span>}
                  {c.email && <span className="text-[12px] text-muted-foreground">{c.email}</span>}
                  {c.note && <span className="ml-auto text-[11px] text-muted-foreground">{c.note}</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        {org.memberships.length > 0 && (
          <section className="mt-4 rounded-xl border bg-card p-4">
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              HRP Membership
            </h2>
            {org.memberships.map((m) => (
              <div key={m.id} className="flex flex-wrap items-baseline gap-2 text-[13px]">
                <span className="font-mono">{m.code}</span>
                <Badge variant={m.status === "ACTIVE" ? "default" : "outline"}>
                  {MEMBERSHIP_STATUS_LABEL[m.status]}
                </Badge>
                {m.contact && <span className="text-muted-foreground">{m.contact.name}</span>}
                <span className="ml-auto text-muted-foreground">할인 {won(m.discountAmount)}</span>
              </div>
            ))}
          </section>
        )}

        <section className="mt-4 rounded-xl border bg-card p-4">
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            견적 {org.quotes.length}건
          </h2>
          {org.quotes.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">아직 견적이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {org.quotes.map((q) => {
                const t = quoteTotals(q.items, q.discountAmount, q.vatRate)
                return (
                  <Link
                    key={q.id}
                    href={`/crm/quotes/${q.id}`}
                    className="flex flex-wrap items-baseline gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors hover:border-border-strong hover:bg-muted/40"
                  >
                    <span className="font-mono text-[12px]">{q.code}</span>
                    <span className="text-[12px] text-muted-foreground">
                      {q.quotedAt.toISOString().slice(0, 10)}
                    </span>
                    <span className="truncate">{q.items[0]?.product.name ?? "—"}</span>
                    {q.items.length > 1 && (
                      <span className="text-[11px] text-muted-foreground">외 {q.items.length - 1}</span>
                    )}
                    <Badge variant="outline" className="ml-auto">
                      {QUOTE_STATUS_LABEL[q.status]}
                    </Badge>
                    <span className="w-[110px] text-right font-mono font-semibold">{won(t.total)}</span>
                  </Link>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
