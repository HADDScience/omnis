"use client"

import { useEffect, useState, type ReactNode } from "react"
import { signOut } from "next-auth/react"
import { clearChatCache } from "@/lib/chat-cache"
import { useTheme } from "next-themes"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  AiMagicIcon,
  ArrowRight01Icon,
  BookOpen01Icon,
  Logout01Icon,
  Moon01Icon,
  Search01Icon,
  Sun01Icon,
} from "@hugeicons/core-free-icons"
import { Card, CardContent } from "@/components/ui/card"
import { ShineBorder } from "@/components/magicui/shine-border"
import { useOnboarding } from "@/components/onboarding/onboarding-provider"
import { useCommandPalette } from "@/components/layout/command-palette-context"
import { cn } from "@/lib/utils"

function Row({
  icon,
  label,
  trailing,
  onClick,
  className,
  itemClassName,
  onboarding,
}: {
  icon: ReactNode
  label: string
  trailing?: ReactNode
  onClick: () => void
  className?: string
  itemClassName?: string
  onboarding?: string
}) {
  return (
    <li className={itemClassName}>
      <button
        type="button"
        onClick={onClick}
        data-onboarding={onboarding}
        className={cn(
          "relative flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left text-[13px] transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
          className
        )}
      >
        {icon}
        <span className="flex-1">{label}</span>
        {trailing ?? (
          <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-muted-foreground" aria-hidden />
        )}
      </button>
    </li>
  )
}

/**
 * 마이 탭의 바로가기 — 예전 사이드바 프로필 메뉴에 있던 것들.
 * 메뉴 안에 숨어 있던 MCP 등록·튜토리얼을 한 화면에 늘어놓아, 찾으러 메뉴를 열 필요가 없게 했다.
 */
export function MyShortcuts() {
  const onboarding = useOnboarding()
  const commandPalette = useCommandPalette()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && theme === "dark"

  return (
    <Card className="py-0">
      <CardContent className="p-0">
        <ul className="flex flex-col divide-y">
          <Row
            onboarding="mcp"
            // 무지개 테두리(ShineBorder)는 이 단추의 모서리(rounded-[inherit])를 따른다. 카드의 첫 줄이라 위 두 모서리를
            // 카드(rounded-xl)와 같게 굴린다 — 각진 채로 두면 카드가 모서리를 잘라 테두리가 끊겨 보였다(2026-10-29 작업지시자)
            className="rounded-t-xl text-primary"
            icon={
              <>
                <ShineBorder
                  shineColor={["#ff3d81", "#ff8a00", "#ffd60a", "#34d399", "#38bdf8", "#a855f7"]}
                  borderWidth={1.5}
                />
                <HugeiconsIcon icon={AiMagicIcon} size={16} aria-hidden />
              </>
            }
            label="Omnis MCP 등록 — 나의 AI 에 Omnis 연결"
            onClick={() => onboarding.openMcp()}
          />
          <Row
            onboarding="replay"
            icon={<HugeiconsIcon icon={BookOpen01Icon} size={16} className="text-muted-foreground" aria-hidden />}
            label="온보딩 튜토리얼 다시 보기"
            onClick={() => onboarding.replay()}
          />
          {/* PC 는 ⌘K 로 연다(nav 에서 돋보기는 뺐다). 폰에는 단축키가 없어 여기 둔다 */}
          <Row
            itemClassName="md:hidden"
            icon={<HugeiconsIcon icon={Search01Icon} size={16} className="text-muted-foreground" aria-hidden />}
            label="검색"
            onClick={() => commandPalette.open()}
          />
          <Row
            icon={
              <HugeiconsIcon
                icon={dark ? Sun01Icon : Moon01Icon}
                size={16}
                className="text-muted-foreground"
                aria-hidden
              />
            }
            label="테마"
            trailing={
              <span className="text-[11.5px] text-muted-foreground" suppressHydrationWarning>
                {mounted ? (dark ? "다크" : "라이트") : "—"}
              </span>
            }
            onClick={() => setTheme(dark ? "light" : "dark")}
          />
          <Row
            className="text-destructive"
            icon={<HugeiconsIcon icon={Logout01Icon} size={16} aria-hidden />}
            label="로그아웃"
            trailing={<span />}
            onClick={async () => {
              // 이 기기에 저장해 둔 채팅(방 목록 · 방별 최근 글)을 먼저 지운다 — lib/chat-cache.ts
              await clearChatCache().catch(() => {})
              await signOut({ callbackUrl: "/", redirectTo: "/" })
            }}
          />
        </ul>
      </CardContent>
    </Card>
  )
}
