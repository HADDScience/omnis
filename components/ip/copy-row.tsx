"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"

/**
 * 값 한 줄과 복사 버튼.
 *
 * 「복사됨」 상태를 스스로 들고 있다. 부모가 들고 있으면 표 안처럼 미리 만들어
 * 둔 트리에는 넣을 수 없어서다.
 *
 * 설치 커맨드와 토큰 원문 양쪽에서 쓴다 — 둘 다 「보이는 값을 그대로 가져가는」
 * 자리라 모양이 같아야 어디를 눌러야 할지 헷갈리지 않는다.
 */
export function CopyRow({
  text,
  className,
  /** 복사 버튼에 붙일 이름. 한 화면에 여럿이면 구분이 필요하다. */
  label = "복사",
}: {
  text: string
  className?: string
  label?: string
}) {
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 클립보드가 막힌 환경(비 HTTPS 등). 값은 화면에 그대로 보이니 손으로 복사한다.
    }
  }

  return (
    <div className={cn("flex items-stretch gap-1", className)}>
      {/* Codex 처럼 두 줄짜리 커맨드가 있어 줄바꿈은 살린다. */}
      <code className="min-w-0 flex-1 overflow-x-auto bg-muted px-2 py-1.5 text-[11.5px] whitespace-pre text-foreground">
        {text}
      </code>
      <button
        type="button"
        onClick={() => void onCopy()}
        aria-label={label}
        className="flex shrink-0 items-center gap-1 px-2 text-[11.5px] font-medium text-muted-foreground rounded-md border transition-colors hover:text-foreground"
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
        {copied ? "복사됨" : label}
      </button>
    </div>
  )
}
