"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { ADMIN_SECTIONS } from "@/lib/admin-sections"
import { cn } from "@/lib/utils"

/**
 * 관리자 페이지 메뉴 — PC 는 왼쪽 세로 목록, 폰은 위쪽 가로 탭. 둘 다 떠 있는 nav 와 같은 유리(.glass)다.
 * 탭 넷이 320px 에서도 한 줄에 들어가게 폰 탭은 짧은 이름(short)을 쓴다.
 */
export function AdminNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="관리자 메뉴" data-admin-nav className="md:sticky md:top-4 md:self-start">
      <ul className="glass grid grid-cols-4 gap-0.5 rounded-full p-1 md:flex md:flex-col md:gap-1 md:rounded-2xl md:p-2">
        {ADMIN_SECTIONS.map((s) => {
          const active = pathname === s.href || pathname.startsWith(`${s.href}/`)
          return (
            <li key={s.href} className="min-w-0">
              <Link
                href={s.href}
                aria-label={s.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "touch-target flex min-h-10 items-center justify-center rounded-full px-1.5 text-[12.5px] whitespace-nowrap transition-colors md:justify-start md:rounded-xl md:px-3 md:text-sm",
                  active ? "glass-pill font-semibold text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="md:hidden" aria-hidden>{s.short}</span>
                <span className="hidden md:inline" aria-hidden>{s.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
