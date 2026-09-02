"use client"

import { cn } from "@/lib/utils"

/**
 * 소셜 로그인 버튼. 각 제공자의 브랜드 가이드를 따른다.
 *  - Google: 흰 바탕(다크에서는 #131314) + 테두리, 4색 G 마크
 *  - 카카오: #FEE500 고정, 검정 말풍선 심볼과 검정 텍스트
 *
 * 마크는 브랜드 자산이라 범용 아이콘셋으로 대체하지 않고 인라인 SVG 로 둔다.
 * 허브(hadd hub)의 같은 이름 컴포넌트와 모양을 맞춰, 사내 도구들의
 * 로그인 화면이 같은 언어를 쓰게 한다.
 *
 * 마크는 설정의 연결 목록에서도 쓰므로 따로 export 한다.
 */

export function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-[18px]", className)} aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  )
}

export function KakaoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={cn("size-[18px]", className)} aria-hidden focusable="false">
      <path
        fill="#000000"
        d="M9 1C4.58 1 1 3.82 1 7.29c0 2.25 1.5 4.22 3.75 5.33-.16.58-.6 2.16-.69 2.5-.11.42.16.41.33.3.13-.09 2.1-1.43 2.95-2.01.54.08 1.1.12 1.66.12 4.42 0 8-2.82 8-6.29S13.42 1 9 1z"
      />
    </svg>
  )
}

export type SocialProvider = "google" | "kakao"

export const SOCIAL_LABEL: Record<SocialProvider, string> = {
  google: "Google",
  kakao: "카카오",
}

export const SocialMark: Record<SocialProvider, (p: { className?: string }) => React.ReactElement> = {
  google: GoogleMark,
  kakao: KakaoMark,
}

interface Props {
  provider: SocialProvider
  onClick: () => void
  disabled?: boolean
  pending?: boolean
  /** 기본은 로그인 문구. 설정의 연결 버튼처럼 다른 맥락이면 넘긴다. */
  label?: string
}

// 터치 타겟 44px 이상 (h-11).
const BASE =
  "relative flex h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2"

const SKIN: Record<SocialProvider, string> = {
  google: cn(
    "border border-[#747775] bg-white text-[#1f1f1f] hover:bg-[#f7f8f8] focus-visible:outline-[#4285f4]",
    "dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1e1f20]"
  ),
  // 카카오 브랜드 색은 라이트/다크 공통으로 유지한다.
  kakao: "bg-[#FEE500] text-black/85 hover:bg-[#f2da00] focus-visible:outline-[#FEE500]",
}

const DEFAULT_LABEL: Record<SocialProvider, string> = {
  google: "Google 계정으로 로그인",
  kakao: "카카오 로그인",
}

export function SocialSignInButton({ provider, onClick, disabled, pending, label }: Props) {
  const Mark = SocialMark[provider]
  const text = label ?? DEFAULT_LABEL[provider]
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={text}
      className={cn(BASE, SKIN[provider])}
    >
      <span className="absolute left-4 flex items-center">
        <Mark />
      </span>
      {pending ? "이동 중…" : text}
    </button>
  )
}
