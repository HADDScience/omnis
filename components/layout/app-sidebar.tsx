"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  DashboardSpeed02Icon,
  Task01Icon,
  BookOpen01Icon,
  FileAttachmentIcon,
  Logout01Icon,
  Moon01Icon,
  Sun01Icon,
  Search01Icon,
  Notification03Icon,
  Settings02Icon,
  UserIcon,
  UserGroupIcon,
  ArrowUp01Icon,
} from "@hugeicons/core-free-icons"
import { signOut } from "next-auth/react"
import { useTheme } from "next-themes"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Kbd } from "@/components/ui/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCommandPalette } from "@/components/layout/command-palette-context"

const navItems = [
  { href: "/dashboard", label: "워크스페이스", icon: DashboardSpeed02Icon },
  { href: "/tasks", label: "내 업무", icon: Task01Icon },
  { href: "/omnis", label: "HADD DB", icon: BookOpen01Icon },
  { href: "/reports", label: "보고서", icon: FileAttachmentIcon },
] as const

const quickFilters = [
  { key: "due-today", label: "오늘 마감", color: "var(--destructive)", href: "/tasks?filter=due-today" },
  { key: "i-assigned", label: "내가 지시한 업무", color: "currentColor", href: "/tasks?filter=i-assigned" },
  { key: "i-own", label: "내가 담당", color: "currentColor", href: "/tasks?filter=i-own" },
  { key: "weekly", label: "주간 보고서", color: "var(--muted-foreground)", href: "/reports" },
] as const

interface AppSidebarProps {
  userName?: string | null
  userEmail?: string | null
  userRole?: string | null
}

export function AppSidebar({ userName, userEmail, userRole }: AppSidebarProps) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const commandPalette = useCommandPalette()
  useEffect(() => setMounted(true), [])

  return (
    <Sidebar>
      <SidebarHeader className="px-2.5 pb-2 pt-3">
        <Link href="/dashboard" className="flex items-center gap-2 px-1.5 pb-3">
          <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-primary text-[13px] font-bold text-primary-foreground">
            O
          </div>
          <div className="flex flex-col leading-[1.1]">
            <span className="text-[13.5px] font-semibold">Omnis</span>
            <span className="font-mono text-[9px] text-muted-foreground">HADDScience</span>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => commandPalette.open()}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-border bg-muted px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground"
        >
          <HugeiconsIcon icon={Search01Icon} size={14} className="opacity-70" />
          <span className="flex-1 text-left">검색</span>
          <Kbd>⌘K</Kbd>
        </button>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">메뉴</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                    render={<Link href={item.href} />}
                  >
                    <HugeiconsIcon icon={item.icon} size={15} />
                    <span className="text-[12.5px]">{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">빠른 필터</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {quickFilters.map((f) => (
                <SidebarMenuItem key={f.key}>
                  <SidebarMenuButton size="sm" render={<Link href={f.href} />}>
                    <span
                      className="inline-block h-[5px] w-[5px] rounded-full"
                      style={{ backgroundColor: f.color }}
                    />
                    <span className="text-[12px]">{f.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                suppressHydrationWarning
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-muted data-[popup-open]:bg-muted"
              />
            }
          >
            <Avatar className="h-[26px] w-[26px] shrink-0">
              <AvatarFallback className="text-[10px]">
                {userName?.charAt(0) ?? "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-[1.1]">
              <span className="truncate text-[12px] font-medium">{userName ?? "사용자"}</span>
              <span className="truncate font-mono text-[9.5px] text-muted-foreground">
                {userRole ?? "MEMBER"}
              </span>
            </div>
            <HugeiconsIcon icon={ArrowUp01Icon} size={10} className="shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-[180px]">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="leading-tight">
                <div className="text-[12.5px] font-semibold">{userName ?? "사용자"}</div>
                {userEmail && (
                  <div className="truncate text-[11px] font-normal text-muted-foreground">
                    {userEmail}
                  </div>
                )}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <HugeiconsIcon icon={UserIcon} size={14} className="text-muted-foreground" />
              프로필
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <HugeiconsIcon icon={UserGroupIcon} size={14} className="text-muted-foreground" />
              팀 설정
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <HugeiconsIcon icon={Notification03Icon} size={14} className="text-muted-foreground" />
              알림 설정
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault()
                setTheme(theme === "dark" ? "light" : "dark")
              }}
              suppressHydrationWarning
            >
              <HugeiconsIcon
                icon={mounted && theme === "dark" ? Sun01Icon : Moon01Icon}
                size={14}
                className="text-muted-foreground"
              />
              <span className="flex-1">테마</span>
              <span className="text-[10.5px] text-muted-foreground">
                {mounted ? (theme === "dark" ? "다크" : "라이트") : "—"}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-destructive data-[highlighted]:text-destructive"
            >
              <HugeiconsIcon icon={Logout01Icon} size={14} />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
