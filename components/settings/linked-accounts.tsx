"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Unlink01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  SocialSignInButton,
  SocialMark,
  SOCIAL_LABEL,
  type SocialProvider,
} from "@/components/auth/social-buttons"

interface Identity {
  provider: string
  email: string | null
  createdAt: string
}

/**
 * 소셜 로그인 연결 관리.
 *
 * 옴니스 계정이 주인이고 소셜은 "들어오는 또 하나의 문"이다. 그래서 연결은
 * 로그인한 상태에서만 시작할 수 있고, 모두 해제해도 비밀번호로 들어올 수 있다.
 */
export function LinkedAccounts() {
  const [identities, setIdentities] = useState<Identity[] | null>(null)
  const [available, setAvailable] = useState<SocialProvider[]>([])
  const [busy, setBusy] = useState<SocialProvider | null>(null)

  useEffect(() => {
    // 어떤 소셜이 켜져 있는지는 서버 설정이 정한다. 화면에 고정해 두면
    // 키를 넣지 않은 제공자 버튼이 떠서 누르면 깨진다.
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((all: Record<string, unknown>) =>
        setAvailable((["google", "kakao"] as SocialProvider[]).filter((p) => p in all))
      )
      .catch(() => setAvailable([]))

    reload()
  }, [])

  function reload() {
    fetch("/api/account/identities")
      .then((r) => (r.ok ? r.json() : []))
      .then(setIdentities)
      .catch(() => setIdentities([]))
  }

  async function unlink(provider: SocialProvider) {
    setBusy(provider)
    const res = await fetch("/api/account/identities", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
    setBusy(null)
    if (!res.ok) {
      toast.error(`${SOCIAL_LABEL[provider]} 연결을 해제하지 못했습니다.`)
      return
    }
    toast.success(`${SOCIAL_LABEL[provider]} 연결을 해제했습니다.`)
    reload()
  }

  if (available.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">소셜 로그인 연결</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          연결해 두면 다음부터 이름·비밀번호 대신 소셜 계정 한 번으로 로그인할 수 있습니다.
          연결을 모두 해제해도 비밀번호로 들어올 수 있습니다.
        </p>

        {identities === null ? (
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-[72px] w-full rounded-lg" />
            <Skeleton className="h-[72px] w-full rounded-lg" />
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {available.map((provider) => {
              const linked = identities.find((i) => i.provider === provider)
              const Mark = SocialMark[provider]
              return (
                <li
                  key={provider}
                  className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={
                        provider === "kakao"
                          ? "flex size-9 shrink-0 items-center justify-center rounded-md bg-[#FEE500]"
                          : "flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-white dark:bg-[#131314]"
                      }
                    >
                      <Mark />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{SOCIAL_LABEL[provider]}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {linked ? (linked.email ?? "연결됨") : "연결 안 됨"}
                      </div>
                    </div>
                  </div>

                  {linked ? (
                    <Button
                      variant="outline"
                      className="h-11 w-full shrink-0 sm:w-auto"
                      disabled={busy === provider}
                      onClick={() => unlink(provider)}
                      aria-label={`${SOCIAL_LABEL[provider]} 연결 해제`}
                    >
                      <HugeiconsIcon icon={Unlink01Icon} size={15} aria-hidden />
                      연결 해제
                    </Button>
                  ) : (
                    <div className="w-full shrink-0 sm:w-[220px]">
                      <SocialSignInButton
                        provider={provider}
                        label={`${SOCIAL_LABEL[provider]} 연결하기`}
                        disabled={busy !== null}
                        pending={busy === provider}
                        onClick={() => {
                          setBusy(provider)
                          // 로그인된 상태로 OAuth를 돌면 서버의 signIn 콜백이 연결로 처리한다.
                          signIn(provider, { callbackUrl: "/settings" })
                        }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
