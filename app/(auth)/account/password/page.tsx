import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { mustChangePassword } from "@/lib/password-state"
import { ChangePasswordForm } from "@/components/auth/change-password-form"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "비밀번호 변경 — HADD SCIENCE" }

/**
 * 비밀번호 변경. 프로필 설정(/settings/profile)이나 임시 비밀번호 안내(components/auth/password-reset-notice.tsx)에서 들어온다.
 * 막지 않는다 — 임시 비밀번호여도 「나중에」 로 앱으로 돌아갈 수 있다(2026-11-06 핫픽스).
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
            ? "관리자가 정해 준 임시 비밀번호를 쓰고 있습니다. 본인만 아는 비밀번호로 바꾸기를 권합니다."
            : `${session.user.name ?? ""} 계정의 비밀번호를 바꿉니다.`}
        </p>
        <div className="mt-6">
          <ChangePasswordForm required={required} />
        </div>
        <Link
          href={required ? "/chat" : "/settings/profile"}
          className="touch-target mt-6 inline-block text-[12.5px] text-muted-foreground underline underline-offset-4"
        >
          {required ? "나중에" : "프로필 설정으로 돌아가기"}
        </Link>
      </div>
    </main>
  )
}
