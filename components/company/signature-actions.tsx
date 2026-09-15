"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import { IS_DEMO } from "@/lib/demo"

/**
 * 서명 · 직인 복사 / 파일로 받기. 과제 대리 작성 때 한글 문서에 붙여 넣는 용도다.
 *
 * 복사는 PNG 를 클립보드에 이미지로 넣는다 → 한글에서 Ctrl+V. 크롬 · 엣지 · 사파리가 지원한다(HTTPS 에서만).
 * 꺼낼 때마다 서버가 활동 로그를 남긴다 — /api/company/staff-assets/[assetId]
 */
export function SignatureActions({
  assetId,
  staffName,
  kind,
}: {
  assetId: string
  staffName: string
  kind: "SIGNATURE" | "SEAL"
}) {
  const label = kind === "SEAL" ? "직인" : "서명"
  const [busy, setBusy] = useState<null | "copy" | "download">(null)

  // 데모에는 NAS가 없어 서명·직인을 꺼낼 수 없다.
  if (IS_DEMO) return null

  async function fetchImage(purpose: "copy" | "download"): Promise<Blob> {
    const res = await fetch(apiUrl(`/api/company/staff-assets/${assetId}?purpose=${purpose}`), { cache: "no-store" })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      throw new Error(body?.error ?? `${label}을 불러오지 못했습니다`)
    }
    const blob = await res.blob()
    return blob.type === "image/png" ? blob : new Blob([blob], { type: "image/png" })
  }

  async function copy() {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      toast.error("이 브라우저는 이미지 복사를 지원하지 않습니다. 「파일로 받기」를 쓰세요")
      return
    }
    setBusy("copy")
    try {
      // 사파리는 클릭 직후에 ClipboardItem 을 만들어야 한다 — 이미지를 기다리지 않고 Promise 를 넘긴다
      await navigator.clipboard.write([new ClipboardItem({ "image/png": fetchImage("copy") })])
      toast.success(`${staffName} ${label}을 복사했습니다. 한글에서 Ctrl+V 로 붙여 넣으세요`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label}을 복사하지 못했습니다`)
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    setBusy("download")
    try {
      const blob = await fetchImage("download")
      const href = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = href
      a.download = `${staffName}_${label}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 1_000)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label}을 받지 못했습니다`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      <Button size="sm" className="touch-target gap-1.5" onClick={copy} disabled={busy !== null} aria-label={`${staffName} ${label} 복사`}>
        {busy === "copy" && <Spinner />}
        {label} 복사
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="touch-target gap-1.5"
        onClick={download}
        disabled={busy !== null}
        aria-label={`${staffName} ${label} 파일로 받기`}
      >
        {busy === "download" && <Spinner />}
        파일로 받기
      </Button>
    </div>
  )
}
