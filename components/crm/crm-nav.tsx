"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { MouseEvent } from "react"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { useCrmTabs } from "./crm-tabs-context"
import { cn } from "@/lib/utils"

const TABS = [
  // 들어오는 것이 먼저다 — 문의는 아직 CRM 이 아니라서 사람이 봐 줘야 앞으로 간다
  { href: "/crm/inquiries", label: "문의" },
  { href: "/crm/quotes", label: "견적" },
  { href: "/crm/samples", label: "샘플요청" },
  { href: "/crm/inventory", label: "재고·출고" },
  { href: "/crm/invoices", label: "세금계산서" },
  { href: "/crm/orgs", label: "기관" },
] as const

/**
 * CRM 안에서 화면을 오간다. 사이드바에는 CRM 하나만 두고 안쪽은 여기서 가른다.
 * 누르면 서버를 기다리지 않고 탭 표시 · 주소 · 스켈레톤이 먼저 바뀐다(components/crm/crm-tabs.tsx).
 * 새 탭으로 열기(⌘ · Ctrl · 가운데 단추)는 브라우저에 맡긴다.
 */
export function CrmNav() {
  const pathname = usePathname()
  const tabs = useCrmTabs()

  const onClick = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!tabs || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (pathname === href) return
    tabs.go(href)
  }

  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]" aria-label="CRM">
      {TABS.map((t) => {
        // 누른 탭은 주소가 바뀌기 전 프레임에도 켜져 있게 한다
        const here = tabs?.pendingHref ?? pathname
        const active = here === t.href || here.startsWith(`${t.href}/`)
        return (
          <Link
            key={t.href}
            href={t.href}
            onClick={(e) => onClick(e, t.href)}
            aria-current={active ? "page" : undefined}
            data-crm-tab={t.href.split("/")[2]}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
              // 누르면 즉시 여기서 반응한다 — 새 화면을 기다리지 않는다
              "has-data-[pending]:bg-muted has-data-[pending]:text-foreground",
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <LinkPendingMark />
          </Link>
        )
      })}
    </nav>
  )
}
