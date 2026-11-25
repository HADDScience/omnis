"use client"

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CrmTabsContext } from "./crm-tabs-context"
import { CrmTabSkeleton, tabOf } from "./crm-tab-skeleton"
import { cn } from "@/lib/utils"

/**
 * CRM 탭 전환 — 누르는 즉시 탭 표시 · 주소가 바뀌고, 내용 자리에 그 탭의 스켈레톤이 선다. 데이터가 오면 채워진다.
 *
 * 각 탭에 loading.tsx 가 있어도 그것만으로는 모자랐다(2026-11-25 사용자 지적 「탭을 누르면 화면이 그냥 멈춰 있다」).
 * 개발 서버 로그로 보면 처음 여는 탭은 컴파일이 3.5~8.5초, 서버 렌더는 0.2~0.6초였다 — 멈춤의 대부분은 개발 모드 컴파일이다.
 * loading.tsx 경계도 그 컴파일이 끝나야 내려오고, 개발 모드는 링크 미리 받기(prefetch)를 하지 않아 그동안 옛 화면이 그대로 있었다.
 * 운영 빌드는 링크를 미리 받아(prefetch) loading 경계가 바로 뜨므로, 멈춤은 주로 개발 서버에서 보인다. 아래 처리는 두 쪽 모두에서 같게 돈다.
 * 그래서 화면이 서버 응답을 기다리지 않고 먼저 움직인다:
 *   ① 누르면 곧바로 그 탭의 스켈레톤을 그리고 history.pushState 로 주소를 바꾼다(Next 앱 라우터가 usePathname 을 맞춰 준다 → 탭 표시도 바뀐다)
 *   ② 주소가 화면에 반영된 뒤에 useTransition 으로 router.replace 를 건다. 같이 걸면 두 transition 이 한데 묶여 주소도 서버 응답까지 기다린다
 *   ③ 새 화면(또는 그 탭의 loading.tsx)이 그려지면 transition 이 끝나고 스켈레톤이 걷힌다
 */

export function CrmTabsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [target, setTarget] = useState<string | null>(null)
  const started = useRef(false)
  const sawPending = useRef(false)

  const navigate = useCallback(
    (href: string) => {
      if (started.current) return
      started.current = true
      startTransition(() => router.replace(href))
    },
    [router]
  )

  const go = useCallback(
    (href: string) => {
      started.current = false
      sawPending.current = false
      setTarget(href)
      // 주소부터 — 서버를 기다리지 않는다. 뒤로 가기는 원래 탭으로 돌아온다
      window.history.pushState(null, "", href)
      // 주소 반영이 늦거나 안 되면(라우터가 pushState 를 못 받으면) 그냥 간다
      setTimeout(() => navigate(href), 150)
    },
    [navigate]
  )

  // ② 주소가 화면에 반영됐다 — 이제 내용을 받으러 간다
  useEffect(() => {
    if (target && pathname === target.split("?")[0]) navigate(target)
  }, [pathname, target, navigate])

  // ③ 새 화면이 그려졌다 — 스켈레톤을 걷는다
  useEffect(() => {
    if (pending) sawPending.current = true
    else if (started.current && sawPending.current) {
      started.current = false
      sawPending.current = false
      setTarget(null)
    }
  }, [pending])

  return (
    <CrmTabsContext.Provider value={{ go, pendingHref: target }}>
      {target && <CrmTabSkeleton tab={tabOf(target)} />}
      {/* 옛 화면은 지우지 않고 감춘다 — 이동이 실패해도 입력하던 것이 남는다 */}
      <div className={cn(target ? "hidden" : "contents")}>{children}</div>
    </CrmTabsContext.Provider>
  )
}
