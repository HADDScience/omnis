"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

const MAX_BYTES = 4 * 1024 * 1024

/**
 * 서명 · 직인 올리기 / 바꾸기 — 관리자 전용 인력 화면에서 쓴다.
 * 미리보기를 띄우지 않는다(목록에 이미지를 띄우지 않는 원칙과 같다). 올린 뒤 크기만 알려 준다.
 */
export function StaffAssetUpload({
  staffId,
  staffName,
  kind,
  replacing,
}: {
  staffId: string
  staffName: string
  kind: "SIGNATURE" | "SEAL"
  replacing: boolean
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const label = kind === "SEAL" ? "직인" : "서명"

  async function upload(file: File) {
    if (file.size > MAX_BYTES) {
      toast.error("4MB 이하 이미지만 올릴 수 있습니다")
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.set("file", file)
      form.set("kind", kind)
      const res = await fetch(apiUrl(`/api/company/staff/${staffId}/assets`), { method: "POST", body: form })
      const body = (await res.json().catch(() => null)) as { error?: string; width?: number | null; height?: number | null; small?: boolean } | null
      if (!res.ok) throw new Error(body?.error ?? `${label}을 올리지 못했습니다`)
      const dims = body?.width && body?.height ? ` (${body.width}×${body.height})` : ""
      if (body?.small) toast.warning(`${staffName} ${label}을 ${replacing ? "바꿨습니다" : "올렸습니다"}${dims} — 가로가 좁아 인쇄하면 흐릴 수 있습니다`)
      else toast.success(`${staffName} ${label}을 ${replacing ? "바꿨습니다" : "올렸습니다"}${dims}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label}을 올리지 못했습니다`)
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void upload(f)
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        className="touch-target gap-1.5"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        aria-label={`${staffName} ${label} ${replacing ? "바꾸기" : "올리기"}`}
        title="투명 배경 PNG, 가로 600px 이상을 권장합니다"
      >
        {busy && <Spinner />}
        {replacing ? "바꾸기" : `${label} 올리기`}
      </Button>
    </>
  )
}
