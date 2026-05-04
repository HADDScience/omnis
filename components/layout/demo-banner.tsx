"use client"

const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true"

export function DemoBanner() {
  if (!IS_DEMO) return null

  return (
    <div className="sticky top-0 z-[60] w-full bg-blue-600 text-white text-xs sm:text-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-3 py-1.5 text-center">
        <span aria-hidden className="text-base leading-none">🚀</span>
        <span className="font-medium">시연용 데모 사이트</span>
        <span className="hidden sm:inline opacity-80">·</span>
        <span className="hidden sm:inline opacity-90">
          모든 데이터는 익명 더미 — 자유롭게 테스트하세요
        </span>
        <span className="opacity-80">·</span>
        <a
          href="https://github.com/HADDScience/omnis"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline"
        >
          소스코드
        </a>
      </div>
    </div>
  )
}
