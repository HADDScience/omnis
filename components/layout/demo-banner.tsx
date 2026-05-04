"use client"

const IS_DEMO = process.env.NEXT_PUBLIC_IS_DEMO === "true"

export function DemoBanner() {
  if (!IS_DEMO) return null

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 z-[100] flex flex-col items-end gap-1 sm:bottom-4 sm:right-4"
      role="status"
      aria-label="시연용 데모 사이트"
    >
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-blue-400/40 sm:text-sm">
        <span aria-hidden className="text-base leading-none">🚀</span>
        <span>시연용 데모</span>
        <span className="opacity-70">·</span>
        <a
          href="https://github.com/HADDScience/omnis"
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-2 hover:underline"
        >
          소스
        </a>
      </div>
      <p className="pointer-events-auto hidden max-w-[18rem] rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] leading-snug text-blue-900 shadow ring-1 ring-blue-200 sm:block dark:bg-blue-950/95 dark:text-blue-100 dark:ring-blue-900">
        모든 데이터는 익명 더미입니다. 자유롭게 테스트하세요.
      </p>
    </div>
  )
}
