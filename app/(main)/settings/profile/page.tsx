import type { Metadata } from "next"
import Link from "next/link"
import { redirect } from "next/navigation"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { Header } from "@/components/layout/header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LinkedAccounts } from "@/components/settings/linked-accounts"
import { SocialBadge } from "@/components/settings/social-badge"
import { auth } from "@/lib/auth"
import { loadMyProfile } from "@/lib/my-profile"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "프로필 설정 — HADD SCIENCE" }

/** 소셜 연결이 막힌 까닭(lib/auth-identity.ts 의 LinkResult) */
const LINK_ERROR: Record<string, string> = {
  taken: "그 소셜 계정은 다른 Omnis 계정에 이미 연결돼 있습니다.",
  "already-linked": "이 계정에는 같은 종류의 소셜 계정이 이미 연결돼 있습니다. 해제한 뒤 다시 연결해 주세요.",
}

/**
 * 프로필 설정 — 마이 화면 위 프로필 카드를 누르면 온다(2026-11-06). 내 정보 확인 · 비밀번호 변경 · 소셜 계정 연결/해제.
 * 예전 마이 화면의 「연결된 계정」 탭(`/settings?tab=accounts`)은 여기로 redirect 한다.
 * 비밀번호 변경 화면은 임시 비밀번호 안내도 쓰는 /account/password 그대로이고, 여기서 그리로 간다.
 */
export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  const profile = await loadMyProfile(session.user.id)
  if (!profile) redirect("/login")
  const { error } = await searchParams
  const linkError = error ? (LINK_ERROR[error] ?? "소셜 계정을 연결하지 못했습니다.") : null

  return (
    <>
      <Header title="프로필 설정" />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-4">
        <Link href="/settings" className="touch-target inline-flex w-fit items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} aria-hidden />
          마이
        </Link>

        {linkError && (
          <p role="alert" data-link-error className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {linkError}
          </p>
        )}

        <Card data-profile-info>
          <CardHeader>
            <CardTitle className="text-base">내 정보</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback className="text-base font-semibold">{profile.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold">{profile.name}</span>
                {profile.social.map((p) => (
                  <SocialBadge key={p} provider={p} />
                ))}
              </span>
            </div>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">이름</dt>
              <dd>{profile.name}</dd>
              <dt className="text-muted-foreground">이메일</dt>
              <dd className="break-all">{profile.email ?? <span className="text-muted-foreground">없음</span>}</dd>
              <dt className="text-muted-foreground">직급</dt>
              <dd data-profile-title>{profile.title ?? <span className="text-muted-foreground">없음</span>}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">이름 · 이메일 · 직급은 관리자가 바꿉니다.</p>
          </CardContent>
        </Card>

        <Card className="py-0">
          <CardContent className="p-0">
            <Link
              href="/account/password"
              data-password-link
              className="touch-target flex min-h-11 items-center gap-3 rounded-xl px-4 py-3 text-sm transition-colors hover:bg-muted"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">비밀번호 변경</span>
                <span className="text-xs text-muted-foreground">이름 · 비밀번호 로그인에 쓰는 비밀번호입니다.</span>
              </span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} className="text-muted-foreground" aria-hidden />
            </Link>
          </CardContent>
        </Card>

        <LinkedAccounts />
      </div>
    </>
  )
}
