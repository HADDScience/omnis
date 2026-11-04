"use client"

import { useMemo } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { LinkPendingMark } from "@/components/ui/pending-link"
import { cn } from "@/lib/utils"
import { formatDate } from "@/lib/ip/date"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import { detect } from "@/lib/ip/detect"

function isActive(pathname: string, href: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (href === "/ip") return path === "/ip"
  return path === href || path.startsWith(`${href}/`)
}

export function SiteNav() {
  const pathname = usePathname()
  const today = useToday()
  const { trademarks, patents, progress } = useData()
  const { isOwner, member } = useAuth()

  // 배지는 "지금 손대야 할 것"만 센다.
  const badge = useMemo(() => {
    const latest = new Map<string, (typeof progress)[number]>()
    for (const e of progress) {
      // 값 정정은 차례를 말하지 않는다. 세면 밀린 일이 배지에서 사라진다.
      if (e.source === "edit") continue
      const k = `${e.entityKind}:${e.entityId}`
      const cur = latest.get(k)
      if (!cur || e.date > cur.date) latest.set(k, e)
    }
    const ours = [...latest.values()].filter((e) => e.nextTurn === "us").length
    return ours + detect(trademarks, patents, today).length
  }, [progress, trademarks, patents, today])

  const items: { href: string; label: string; badge?: number }[] = [
    { href: "/ip", label: "현황" },
    // IP 옆 숫자는 보유 건수, 밀린 업무 옆 숫자는 손댈 것의 수다. 뜻이 다르다.
    {
      href: "/ip/register",
      label: "IP",
      badge: trademarks.length + patents.length,
    },
    { href: "/ip/todo", label: "밀린 IP 업무", badge },
  ]

  // 멤버 관리는 관리자에게만 보인다.
  if (isOwner) items.push({ href: "/ip/members", label: "멤버" })

  return (
    // CRM 의 CrmNav 와 같은 띠. 오른쪽 끝에 오늘 날짜와 내 이름(예전 머리줄에 있던 것)
    <nav className="mb-5 flex items-end gap-1 border-b">
      <div
        data-tutorial="workflow"
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]"
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "touch-target flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] whitespace-nowrap transition-colors",
                "has-data-[pending]:bg-muted has-data-[pending]:text-foreground",
                active
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {item.label}
              {item.badge ? (
                <span
                  className={cn(
                    "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums",
                    active ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground"
                  )}
                >
                  {item.badge}
                </span>
              ) : null}
              <LinkPendingMark />
            </Link>
          )
        })}
      </div>
      <div className="hidden shrink-0 pb-2 text-right text-[12px] leading-tight text-muted-foreground md:block">
        오늘 <span className="tabular-nums">{formatDate(today)}</span> (KST) ·{" "}
        <span title={member.email}>
          {member.displayName ?? member.email}
          {member.role === "viewer" ? " · 읽기 전용" : ""}
        </span>
      </div>
    </nav>
  )
}
