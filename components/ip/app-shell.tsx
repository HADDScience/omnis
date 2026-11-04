"use client"

import { AuthGate } from "@/components/ip/auth-gate"
import { DataProvider } from "@/components/ip/data-provider"
import { SiteHeader } from "@/components/ip/site-header"
import { SiteNav } from "@/components/ip/site-nav"

/**
 * 지식재산권 화면의 틀. 옴니스 제목줄(SiteHeader) → 아카이브 띠 → 본문.
 * 본문 맨 위의 IP 탭 띠(SiteNav)는 CRM 의 CrmNav 와 같은 모양이다.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <DataProvider>
        <SiteHeader />
        <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6">
          <SiteNav />
          {children}
          <p className="mt-10 text-[12px] text-muted-foreground">
            모든 변경은 즉시 저장되고 수정 이력이 남습니다.
          </p>
        </div>
      </DataProvider>
    </AuthGate>
  )
}
