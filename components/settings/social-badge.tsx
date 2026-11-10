"use client"


import { GoogleMark, KakaoMark, SOCIAL_LABEL, type SocialProvider } from "@/components/auth/social-buttons"
import { cn } from "@/lib/utils"

/**
 * 이름 옆의 작은 소셜 표시 — 연결된 것만 보인다. 카카오 마크는 검은색이라 다크 바탕에서도 보이게 노란 원 위에,
 * 구글은 흰 원 위에 둔다(각 사의 로그인 단추 바탕색).
 */
export function SocialBadge({ provider, className }: { provider: SocialProvider; className?: string }) {
  const Mark = provider === "google" ? GoogleMark : KakaoMark
  return (
    <span
      role="img"
      aria-label={`${SOCIAL_LABEL[provider]} 연결됨`}
      title={`${SOCIAL_LABEL[provider]} 연결됨`}
      data-social-badge={provider}
      className={cn(
        "inline-flex size-[18px] shrink-0 items-center justify-center rounded-full",
        provider === "google" ? "bg-white ring-1 ring-black/10" : "bg-[#FEE500]",
        className,
      )}
    >
      <Mark className="size-[11px]" />
    </span>
  )
}
