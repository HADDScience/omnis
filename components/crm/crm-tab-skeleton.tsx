"use client"

import { HeaderSkeleton, ListHeadSkeleton, CardListSkeleton, TableSkeleton } from "@/components/ui/page-skeleton"
import { CrmNav } from "./crm-nav"
import { cn } from "@/lib/utils"

export type CrmTab = "inquiries" | "quotes" | "samples" | "inventory" | "invoices" | "orgs"

export function tabOf(href: string): CrmTab {
  const seg = href.split("?")[0].split("/")[2] ?? ""
  return (["inquiries", "quotes", "samples", "inventory", "invoices", "orgs"] as const).find((t) => t === seg) ?? "quotes"
}

/**
 * 탭마다 실제 화면과 같은 폭 · 줄 수의 스켈레톤. 탭 줄은 진짜(CrmNav)라 누른 탭이 바로 켜져 있다.
 * 탭 전환(crm-tabs.tsx)과 각 탭의 loading.tsx 가 같은 것을 쓴다 — 둘이 이어져도 화면이 튀지 않게.
 */
export function CrmTabSkeleton({ tab }: { tab: CrmTab }) {
  const wide = tab === "quotes" || tab === "orgs" || tab === "invoices"
  return (
    <div data-crm-tab-skeleton={tab} aria-busy="true" className="contents">
      <HeaderSkeleton />
      <div
        className={cn(
          "mx-auto w-full py-6",
          wide ? "max-w-[1100px]" : "max-w-[1000px]",
          tab === "invoices" ? "px-4 sm:px-6" : "px-6",
          tab === "inventory" && "pb-20"
        )}
      >
        <CrmNav />
        <ListHeadSkeleton />
        {tab === "quotes" && <TableSkeleton rows={9} cols={7} />}
        {tab === "inquiries" && <CardListSkeleton count={5} lines={2} />}
        {tab === "samples" && <CardListSkeleton count={6} lines={2} />}
        {tab === "invoices" && <CardListSkeleton count={6} lines={2} />}
        {tab === "orgs" && <CardListSkeleton count={7} lines={1} />}
        {tab === "inventory" && (
          <>
            <CardListSkeleton count={2} lines={3} />
            <div className="mt-8">
              <ListHeadSkeleton />
              <CardListSkeleton count={4} lines={1} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
