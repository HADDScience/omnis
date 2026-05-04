"use client"

import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"

const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true"

const ACCOUNTS = [
  { name: "팀장", role: "ADMIN", note: "업무 지시·캔버스 전체" },
  { name: "부팀장", role: "ADMIN", note: "동일 권한" },
  { name: "사원1", role: "MEMBER", note: "업무 수행·체크리스트" },
  { name: "사원2", role: "MEMBER", note: "동일" },
  { name: "사원3", role: "MEMBER", note: "동일" },
]

const DEMO_PASSWORD = "demo1234"

export function DemoAccountsCard() {
  const router = useRouter()
  const [pendingName, setPendingName] = useState<string | null>(null)

  if (!IS_DEMO) return null

  async function quickLogin(name: string) {
    setPendingName(name)
    const result = await signIn("credentials", {
      name,
      password: DEMO_PASSWORD,
      redirect: false,
    })
    if (!result?.error) {
      router.push("/dashboard")
      router.refresh()
    } else {
      setPendingName(null)
    }
  }

  return (
    <div className="mt-4 w-full max-w-sm rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span aria-hidden>🧪</span>
        시연용 테스트 계정
      </div>
      <p className="mb-3 text-xs text-blue-800/80 dark:text-blue-200/80">
        클릭 한 번으로 로그인 · 비밀번호는 모두{" "}
        <code className="rounded bg-blue-100 px-1 py-0.5 text-[11px] dark:bg-blue-900/50">
          {DEMO_PASSWORD}
        </code>
      </p>
      <ul className="flex flex-col gap-1.5">
        {ACCOUNTS.map((a) => (
          <li key={a.name} className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-[72px] justify-center bg-white text-blue-900 dark:bg-blue-950 dark:text-blue-100"
              disabled={pendingName !== null}
              onClick={() => quickLogin(a.name)}
            >
              {pendingName === a.name ? "..." : a.name}
            </Button>
            <span className="text-[11px] font-mono text-blue-700/80 dark:text-blue-300/80">
              {a.role}
            </span>
            <span className="text-xs text-blue-800/70 dark:text-blue-200/70">
              {a.note}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
