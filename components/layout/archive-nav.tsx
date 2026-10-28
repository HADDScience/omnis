"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { LinkSquare02Icon } from "@hugeicons/core-free-icons"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { cn } from "@/lib/utils"

const IP_PLATFORM_URL = "https://haddscience.github.io/ip-platform/"

type Item = {
  href: string
  label: string
  isActive?: (pathname: string) => boolean
  external?: boolean
}

const ITEMS: readonly Item[] = [
  {
    href: "/omnis",
    label: "지식 카드",
    isActive: (p) => (p === "/omnis" || p.startsWith("/omnis/")) && !p.startsWith("/omnis/nas"),
  },
  { href: "/omnis/nas", label: "NAS", isActive: (p) => p.startsWith("/omnis/nas") },
  // 화면은 아직 밖에 있다. 데이터는 이미 Omnis DB(ip 스키마)라, 화면을 들이는 날 href 만 바꾸면 된다
  { href: IP_PLATFORM_URL, label: "지식재산권", external: true },
  { href: "/crm/quotes", label: "고객·견적", isActive: (p) => p.startsWith("/crm") },
]

/**
 * 아카이브 탭 안에서 화면을 오간다 — 회사가 가진 것(지식·파일·권리·거래처)을 한 탭에 모았다.
 * 각 화면은 원래 경로 그대로고, 이 띠는 HADD DB(/omnis)와 CRM(/crm) 레이아웃이 함께 얹는다.
 */
export function ArchiveNav() {
  const pathname = usePathname()
  return (
    <nav
      aria-label="아카이브"
      className="flex shrink-0 gap-1 overflow-x-auto border-b bg-background px-3 [scrollbar-width:none]"
    >
      {ITEMS.map((item) => {
        const active = !item.external && (item.isActive?.(pathname) ?? false)
        const className = cn(
          "touch-target inline-flex shrink-0 items-center gap-1 border-b-2 px-3 py-2 text-[12.5px] transition-colors",
          "has-data-[pending]:bg-muted has-data-[pending]:text-foreground",
          active
            ? "border-primary font-semibold text-foreground"
            : "border-transparent text-muted-foreground hover:text-foreground"
        )
        if (item.external) {
          return (
            <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
              {item.label}
              <HugeiconsIcon icon={LinkSquare02Icon} size={11} className="opacity-50" aria-label="새 탭에서 열림" />
            </a>
          )
        }
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={className}>
            {item.label}
            <LinkPendingMark />
          </Link>
        )
      })}
    </nav>
  )
}
