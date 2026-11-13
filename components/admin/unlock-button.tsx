"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { apiUrl } from "@/lib/base-path"

/** 로그인 잠금 해제 — 실패 수를 0 으로 되돌린다. 감사 기록은 서버가 남긴다(app/api/admin/users/[id]/unlock) */
export function UnlockButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function unlock() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiUrl(`/api/admin/users/${userId}/unlock`), { method: "POST" })
      if (res.status === 409) toast.message(`${name} 님은 이미 잠겨 있지 않습니다`)
      else if (!res.ok) throw new Error(`풀지 못했습니다 (${res.status})`)
      else toast.success(`${name} 님의 로그인 잠금을 풀었습니다`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "풀지 못했습니다")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      data-unlock={userId}
      disabled={busy}
      onClick={() => void unlock()}
      className="touch-target inline-flex min-h-9 items-center rounded-full border border-destructive/40 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60"
    >
      {busy ? "푸는 중…" : "잠금 해제"}
    </button>
  )
}
