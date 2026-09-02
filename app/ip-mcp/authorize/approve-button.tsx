"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"

/**
 * 승인 버튼.
 *
 * 서버가 돌려준 주소로 **그대로** 옮겨간다. 우리가 주소를 조립하지 않는 이유는,
 * redirect_uri 는 등록된 값이어야 하고 그 판단이 서버에 있기 때문이다 —
 * 클라이언트가 만들면 검사받지 않은 주소로 코드를 흘릴 길이 생긴다.
 */
export function ApproveButton({ req }: { req: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch("/api/ip-mcp/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ req }),
      })
      const body = (await res.json()) as { redirect?: string; error?: string }
      if (!res.ok || !body.redirect) {
        setPending(false)
        setError(body.error ?? "승인에 실패했습니다. 다시 시도해 주세요.")
        return
      }
      window.location.assign(body.redirect)
    } catch {
      setPending(false)
      setError("서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.")
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => void approve()}
        className={cn(
          "mt-5 h-12 w-full rounded-lg bg-primary px-4 text-[14px] font-semibold",
          "text-primary-foreground shadow-lg shadow-primary/20 transition-opacity",
          "outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary",
          "disabled:cursor-not-allowed disabled:opacity-60"
        )}
      >
        {pending ? "연결하는 중…" : "연결 승인"}
      </button>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-[12.5px] text-destructive"
        >
          {error}
        </p>
      ) : null}
    </>
  )
}
