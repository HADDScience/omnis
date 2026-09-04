"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

const TABS = [
  { href: "/crm/quotes", label: "견적" },
  { href: "/crm/samples", label: "샘플요청" },
  { href: "/crm/inventory", label: "재고·출고" },
  { href: "/crm/orgs", label: "기관" },
] as const

/** CRM 안에서 화면을 오간다. 사이드바에는 CRM 하나만 두고 안쪽은 여기서 가른다. */
export function CrmNav() {
  const pathname = usePathname()
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b [scrollbar-width:none]">
      {TABS.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`)
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-[13px] transition-colors",
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
