"use client"

import { useId } from "react"

import { cn } from "@/lib/utils"

/**
 * AI 표식 — 네 갈래 별 하나와 곁별 하나.
 *
 * 상단바의 다른 아이콘(새로고침·테마·로그아웃)은 전부 같은 굵기의 단색 선이라
 * 그 사이에 끼면 무엇이든 묻힌다. 여기만 색을 준 이유는 이 버튼이 「도구를
 * 붙이는 곳」이라 다른 버튼과 성격이 다르기 때문이다.
 *
 * 그라디언트 id 는 `useId` 로 만든다. 이 표식은 상단바와 기록하기 화면에 동시에
 * 뜨는데, 고정 id 를 쓰면 두 번째 별이 첫 번째의 그라디언트를 참조해 한쪽을
 * 지우면 다른 쪽 색이 사라진다.
 */
export function AiMark({ className }: { className?: string }) {
  const id = useId()
  const grad = `hadd-ai-${id}`

  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("shrink-0", className)}
      fill="none"
    >
      <defs>
        <linearGradient
          id={grad}
          x1="2"
          y1="2"
          x2="22"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="var(--color-sky-500)" />
          <stop offset="45%" stopColor="var(--color-violet-500)" />
          <stop offset="100%" stopColor="var(--color-pink-500)" />
        </linearGradient>
      </defs>

      {/* 큰 별. 네 갈래가 오목하게 파인 형태라 다이아처럼 보인다. */}
      <path
        d="M12 1.6c.62 5.09 3.71 8.18 8.8 8.8-5.09.62-8.18 3.71-8.8 8.8-.62-5.09-3.71-8.18-8.8-8.8 5.09-.62 8.18-3.71 8.8-8.8Z"
        fill={`url(#${grad})`}
      />

      {/* 곁별. 큰 별만 있으면 심심해서 오른쪽 아래에 작게 하나 더 둔다. */}
      <path
        className="hadd-ai-twinkle"
        d="M18.6 15.2c.26 2.13 1.55 3.42 3.68 3.68-2.13.26-3.42 1.55-3.68 3.68-.26-2.13-1.55-3.42-3.68-3.68 2.13-.26 3.42-1.55 3.68-3.68Z"
        fill={`url(#${grad})`}
      />
    </svg>
  )
}
