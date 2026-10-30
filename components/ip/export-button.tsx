"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Download04Icon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"

/** 현재 필터가 적용된 화면만 엑셀로 내려받는 버튼 */
export function ExportViewButton({
  count,
  onExport,
  label = "이 화면 엑셀",
}: {
  count: number
  onExport: () => Promise<void>
  label?: string
}) {
  const [busy, setBusy] = useState(false)

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || count === 0}
      onClick={async () => {
        setBusy(true)
        try {
          await onExport()
        } finally {
          setBusy(false)
        }
      }}
    >
      <HugeiconsIcon icon={Download04Icon} strokeWidth={2} />
      {busy ? "생성 중…" : `${label} (${count})`}
    </Button>
  )
}
