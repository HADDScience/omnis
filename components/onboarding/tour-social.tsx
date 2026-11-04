"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"
import {
  SocialSignInButton,
  SOCIAL_LABEL,
  type SocialProvider,
} from "@/components/auth/social-buttons"
import { apiUrl } from "@/lib/base-path"

/**
 * 간편 로그인 장면의 연결 버튼. 마이의 「소셜 로그인 연결」(components/settings/linked-accounts.tsx)과 같은 출처를 읽는다 —
 * 켜진 제공자는 /api/auth/providers, 이미 연결한 것은 /api/account/identities. 둘 다 읽기다.
 *
 * 버튼을 누르면 구글 · 카카오 화면으로 나갔다 이 화면으로 돌아온다. 나가기 전에 `onLeave` 가 다음 장면을 적어 둔다.
 * 로그인한 채로 OAuth 를 돌면 서버의 signIn 콜백이 지금 계정에 연결한다(lib/auth.ts).
 */
export function TourSocial({ onLeave }: { onLeave: () => void }) {
  const [available, setAvailable] = useState<SocialProvider[] | null>(null)
  const [linked, setLinked] = useState<string[]>([])
  const [busy, setBusy] = useState<SocialProvider | null>(null)
  useEffect(() => {
    let alive = true
    fetch(apiUrl("/api/auth/providers"))
      .then((r) => r.json())
      .then((all: Record<string, unknown>) => {
        if (alive)
          setAvailable(
            (["google", "kakao"] as SocialProvider[]).filter((p) => p in all)
          )
      })
      .catch(() => alive && setAvailable([]))
    fetch(apiUrl("/api/account/identities"))
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { provider: string }[]) => {
        if (alive) setLinked(rows.map((row) => row.provider))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])
  if (available === null)
    return <div className="tour-social" aria-busy="true" />
  // 키가 없는 곳(로컬 · 데모)은 버튼을 띄우지 않는다 — 눌러도 깨진다
  if (available.length === 0)
    return (
      <p className="tour-social-later">
        마이의 「소셜 로그인 연결」에서 언제든 연결할 수 있어요.
      </p>
    )
  return (
    <div className="tour-social">
      {available.map((provider) =>
        linked.includes(provider) ? (
          <span key={provider} className="tour-social-linked">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={15} aria-hidden />
            {SOCIAL_LABEL[provider]} 연결됨
          </span>
        ) : (
          <SocialSignInButton
            key={provider}
            provider={provider}
            label={`${SOCIAL_LABEL[provider]} 연결하기`}
            disabled={busy !== null}
            pending={busy === provider}
            onClick={() => {
              setBusy(provider)
              onLeave()
              void signIn(provider, { callbackUrl: window.location.href })
            }}
          />
        )
      )}
    </div>
  )
}
