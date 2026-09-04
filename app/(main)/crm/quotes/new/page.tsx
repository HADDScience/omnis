import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { QuoteComposer } from "@/components/crm/quote-composer"

export const dynamic = "force-dynamic"

export default async function NewQuotePage() {
  const [orgs, products] = await Promise.all([
    prisma.crmOrg.findMany({
      orderBy: { name: "asc" },
      include: {
        contacts: { orderBy: { name: "asc" } },
        memberships: { where: { status: "ACTIVE" } },
      },
    }),
    prisma.crmProduct.findMany({
      where: { archived: false, isMaterial: false },
      orderBy: { code: "asc" },
    }),
  ])

  return (
    <>
      <Header crumbs={["CRM", "견적", "새 견적"]} />
      <QuoteComposer
        orgs={orgs.map((o) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          contacts: o.contacts.map((c) => ({ id: c.id, name: c.name, title: c.title })),
          membership: o.memberships[0]
            ? { id: o.memberships[0].id, discountAmount: o.memberships[0].discountAmount }
            : null,
        }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          spec: p.spec,
          kind: p.kind,
          unitPrice: p.unitPrice,
        }))}
      />
    </>
  )
}
