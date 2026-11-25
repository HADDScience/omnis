import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { QuoteComposer } from "@/components/crm/quote-composer"

export const dynamic = "force-dynamic"

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org: initialOrgId } = await searchParams
  const [orgs, products, legacy] = await Promise.all([
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
    // 타입으로 옮긴 지난 규격별 젤 행 — 단가를 (타입, 농도, 용량) 기본값으로 쓴다
    prisma.crmProduct.findMany({
      where: { mergedIntoId: { not: null }, unitPrice: { not: null }, volumeMl: { not: null }, concentrationPct: { not: null } },
      select: { mergedIntoId: true, unitPrice: true, volumeMl: true, concentrationPct: true },
    }),
  ])
  const gelTypeById = new Map(products.filter((p) => p.gelType).map((p) => [p.id, p.gelType!]))

  return (
    <>
      <Header crumbs={["CRM", "견적", "새 견적"]} />
      <QuoteComposer
        initialOrgId={initialOrgId ?? null}
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
          gelType: p.gelType,
        }))}
        gelPrices={legacy.flatMap((l) => {
          const g = l.mergedIntoId ? gelTypeById.get(l.mergedIntoId) : undefined
          return g ? [{ gelType: g, conc: Number(l.concentrationPct), volumeMl: Number(l.volumeMl), unitPrice: l.unitPrice! }] : []
        })}
      />
    </>
  )
}
