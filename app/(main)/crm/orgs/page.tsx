import Link from "next/link"
import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"
import { ORG_TYPE_LABEL, CONTACT_NO_NAME, won, quoteTotals } from "@/lib/crm"

export const dynamic = "force-dynamic"

export default async function CrmOrgsPage() {
  const orgs = await prisma.crmOrg.findMany({
    orderBy: { name: "asc" },
    include: {
      contacts: { orderBy: { name: "asc" } },
      memberships: true,
      quotes: { include: { items: true } },
    },
  })

  return (
    <>
      <Header crumbs={["CRM", "기관"]} />
      <div className="mx-auto w-full max-w-[1100px] px-6 py-6">
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">기관</h1>
          <span className="text-[13px] text-muted-foreground">
            {orgs.length}곳 · 담당자 {orgs.reduce((a, o) => a + o.contacts.length, 0)}명
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {orgs.map((o) => {
            const revenue = o.quotes.reduce(
              (a, q) => a + quoteTotals(q.items, q.discountAmount, q.vatRate).total,
              0
            )
            const hrp = o.memberships.find((m) => m.status === "ACTIVE")
            return (
              <div key={o.id} className="rounded-xl border bg-card p-3.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/crm/orgs/${o.id}`}
                    className="text-[14px] font-semibold hover:underline"
                  >
                    {o.name}
                  </Link>
                  <Badge variant="outline">{ORG_TYPE_LABEL[o.type]}</Badge>
                  {hrp && <Badge>HRP</Badge>}
                  <span className="ml-auto text-[12px] text-muted-foreground">
                    견적 {o.quotes.length}건
                    {revenue > 0 && ` · ${won(revenue)}`}
                  </span>
                </div>

                {o.contacts.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.contacts.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-[12px]"
                      >
                        {c.name === CONTACT_NO_NAME && (
                          <HugeiconsIcon
                            icon={Alert02Icon}
                            size={12}
                            className="text-destructive"
                            aria-hidden
                          />
                        )}
                        <span className={c.name === CONTACT_NO_NAME ? "text-destructive" : ""}>
                          {c.name}
                        </span>
                        {c.title && <span className="text-muted-foreground">{c.title}</span>}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">등록된 담당자가 없습니다</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
