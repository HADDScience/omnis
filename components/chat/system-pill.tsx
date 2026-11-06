import type { ReactNode } from "react"

/**
 * 가운데 알약 안내 — 지운 글 · 시스템 글. 말풍선과 묶지 않고 날짜 구분과 같은 모양으로 둔다.
 * 길면 알약 안에서 줄을 바꾼다 — 재구성 요약은 한 줄을 넘고, 380px 패널 밖으로 잘린 적이 있다(2026-09-15 녹화).
 */
export function SystemPill({ children, messageId }: { children: ReactNode; messageId?: string }) {
  return (
    <div data-message-id={messageId} data-system-pill className="mt-2 flex justify-center in-data-[messenger]:mt-3">
      <span className="flex min-h-[26px] max-w-[85%] items-center rounded-[13px] bg-muted px-3 py-1 text-center text-[11px] leading-snug break-keep text-muted-foreground [overflow-wrap:anywhere] in-data-[messenger]:text-[13px]">
        {children}
      </span>
    </div>
  )
}
