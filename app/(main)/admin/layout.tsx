import type { Metadata } from "next"

import { AdminNav } from "@/components/admin/admin-nav"
import { Header } from "@/components/layout/header"
import { requireAdminPage } from "@/lib/admin-access-server"

export const metadata: Metadata = { title: { template: "%s · 관리자", default: "관리자" } }
export const dynamic = "force-dynamic"

/**
 * 관리자 페이지 — 흩어져 있던 관리 화면을 한 곳에 묶는다(2026-11-13). 관리자가 아니면 404(lib/admin-access.ts).
 * 기존 주소(/settings/ai-budget 같은 것)는 그대로 둔다 — 같은 섹션 컴포넌트(components/admin/*-section.tsx)를 함께 쓴다.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return (
    <>
      <Header crumbs={["마이", "관리자"]} />
      <div data-admin-page className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-6 md:py-6">
        <AdminNav />
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </>
  )
}
