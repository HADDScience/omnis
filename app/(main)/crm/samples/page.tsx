import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { prisma } from "@/lib/db"
import { SampleList } from "@/components/crm/sample-list"
import { NewRecordButton } from "@/components/crm/new-record-button"

export const dynamic = "force-dynamic"

export default async function CrmSamplesPage() {
  const samples = await prisma.crmSampleRequest.findMany({
    orderBy: { requestedAt: "desc" },
    include: { org: true, contact: true, product: true },
  })

  return (
    <>
      <Header crumbs={["CRM", "샘플요청"]} actions={<NewRecordButton />} />
      <div className="mx-auto w-full max-w-[1000px] px-6 py-6">
        <CrmNav />
        <SampleList
          samples={samples.map((s) => ({
            id: s.id,
            code: s.code,
            requestedAt: s.requestedAt.toISOString().slice(0, 10),
            orgName: s.org.name,
            orgId: s.orgId,
            contactName: s.contact?.name ?? null,
            productName: s.product?.name ?? null,
            request: s.request,
            referral: s.referral,
            sent: s.status === "SENT",
            note: s.note,
          }))}
        />
      </div>
    </>
  )
}
