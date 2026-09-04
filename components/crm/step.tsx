"use client"

import { useEffect, useRef, type ReactNode } from "react"

/**
 * 한 번에 하나씩 묻는 칸.
 *
 * 앞의 답이 정해져야 다음 칸이 나타난다. 빈 칸을 한꺼번에 늘어놓으면 어디부터
 * 손대야 할지, 무엇이 필수인지 사람이 판단해야 한다. 순서는 화면이 이미 안다.
 *
 * 채운 칸은 그대로 남아 계속 고칠 수 있다 — 되돌아갈 수 없는 마법사가 아니다.
 */
export function Step({
  show = true,
  label,
  hint,
  children,
  autoFocus,
}: {
  show?: boolean
  label: string
  hint?: ReactNode
  children: ReactNode
  autoFocus?: boolean
}) {
  // 라벨 줄이 아니라 **입력 영역**만 본다. 「건너뛰기」 같은 보조 버튼이 라벨 옆에
  // 있어서, 단계 전체에서 첫 버튼을 찾으면 그쪽으로 커서가 간다.
  const bodyRef = useRef<HTMLDivElement>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (!show || !autoFocus || focused.current) return
    focused.current = true
    const el = bodyRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled])"
    )
    const t = setTimeout(() => el?.focus(), 260)
    return () => clearTimeout(t)
  }, [show, autoFocus])

  if (!show) return null
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[12px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div ref={bodyRef}>{children}</div>
    </div>
  )
}
