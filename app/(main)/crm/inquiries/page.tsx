import { Header } from "@/components/layout/header"
import { CrmNav } from "@/components/crm/crm-nav"
import { InquiryList } from "@/components/crm/inquiry-list"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

export default async function CrmInquiriesPage() {
  // NEW 가 먼저, 그 안에서 최신 순. 들어온 것을 처리하는 화면이라 처리된 것은 아래로 내린다.
  const inquiries = await prisma.websiteInquiry.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      createdAt: true,
      name: true,
      organization: true,
      email: true,
      topic: true,
      message: true,
      lang: true,
      status: true,
      quoteId: true,
    },
  })

  return (
    <>
      <Header crumbs={["CRM", "문의"]} />
      <div className="mx-auto w-full max-w-[1000px] px-6 py-6">
        <CrmNav />
        <InquiryList
          inquiries={inquiries.map((i) => ({
            ...i,
            createdAt: i.createdAt.toISOString(),
          }))}
        />
      </div>
    </>
  )
}
