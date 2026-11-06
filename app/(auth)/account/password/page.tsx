import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { mustChangePassword } from "@/lib/password-state"
import { ChangePasswordForm } from "@/components/auth/change-password-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "비밀번호 변경 — HADD SCIENCE" }

/**
 * 비밀번호 변경. 마이 화면에서 들어오거나, 관리자가 정해 준 비밀번호로 로그인했을 때
 * (main)/layout.tsx 가 보낸다. 그래서 (main) 밖에 둔다 — 안에 두면 보내는 곳과 받는 곳이 같아 돈다.
 */
export default async function ChangePasswordPage() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const required = await mustChangePassword(session.user.id)

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <div className="w-full max-w-[420px]">
        <h1 className="text-[24px] font-semibold leading-tight">비밀번호 변경</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
          {required
            ? "관리자가 정해 준 비밀번호로 로그인했습니다. 계속하려면 본인만 아는 비밀번호로 바꾸세요."
            : `${session.user.name ?? ""} 계정의 비밀번호를 바꿉니다.`}
        </p>
        <div className="mt-6">
          <ChangePasswordForm required={required} />
        </div>
        {!required && (
          <Link href="/settings?tab=accounts" className="mt-6 inline-block text-[12.5px] text-muted-foreground underline underline-offset-4">
            마이로 돌아가기
          </Link>
        )}
      </div>
    </main>
  )
}
