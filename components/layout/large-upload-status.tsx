"use client"

// 큰 첨부 진행 표시 — 화면을 옮겨도 남는다. 폰에는 화면을 켜 두라는 한 줄을 함께 띄운다.
// 방 헤더 아래에 둔다. 헤더를 덮으면 올리는 동안 다른 방으로 나가는 뒤로 가기를 막는다.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import { isTouchTyping } from "@/lib/enter-to-send"
import {
  cancelLargeUpload,
  discardResumable,
  largeUploadServerSnapshot,
  largeUploadSnapshot,
  listResumable,
  subscribeLargeUploads,
  type ResumableView,
} from "@/lib/large-upload/client"
import { largeUploadClientEnabled } from "@/lib/large-upload/rules"

function StatusRow({ children }: { children: React.ReactNode }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-2xl border bg-background/95 px-3 py-1.5 text-xs shadow-sm">{children}</div>
}

function Status() {
  const uploads = useSyncExternalStore(subscribeLargeUploads, largeUploadSnapshot, largeUploadServerSnapshot)
  const [resumable, setResumable] = useState<ResumableView[]>([])
  const refresh = useCallback(() => void listResumable().then(setResumable).catch(() => {}), [])
  const active = uploads.length

  // 처음 열 때와 올리기가 끝날 때 다시 본다
  useEffect(() => {
    refresh()
  }, [active, refresh])

  if (uploads.length === 0 && resumable.length === 0) return null
  return (
    <div
      data-large-upload-status
      className="pointer-events-none fixed inset-x-3 top-[calc(var(--demo-banner-height,0px)+var(--safe-top,0px)+4.5rem)] z-[var(--z-banner)] mx-auto flex max-w-sm flex-col gap-1.5 md:top-[calc(var(--demo-banner-height,0px)+7.5rem)]"
    >
      {uploads.map((u) => (
        <div key={u.id} className="pointer-events-auto">
          <StatusRow>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="min-w-0 truncate font-medium">{u.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground" data-large-upload-percent>{u.percent}%</span>
                {u.remaining && <span className="shrink-0 text-muted-foreground max-[320px]:hidden">{u.remaining}</span>}
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={u.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${u.name} 올리는 중`}>
                <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${u.percent}%` }} />
              </div>
              {isTouchTyping() && <p className="mt-1 text-[11px] text-muted-foreground">다 올라갈 때까지 화면을 켜 두세요</p>}
            </div>
            <button
              type="button"
              onClick={() => cancelLargeUpload(u.id)}
              aria-label={`${u.name} 올리기 멈추기`}
              className="touch-target flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-muted"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden />
            </button>
          </StatusRow>
        </div>
      ))}
      {resumable.map((r) => (
        <div key={r.fingerprint} className="pointer-events-auto">
          <StatusRow>
            <p className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.name} {r.percent}%에서 멈춤</span>
              <span className="text-muted-foreground">같은 파일을 다시 첨부하면 이어서 올립니다</span>
            </p>
            <button
              type="button"
              onClick={() => void discardResumable(r.fingerprint).then(refresh)}
              className="touch-target shrink-0 rounded-full px-2 py-1 font-medium text-muted-foreground hover:bg-muted"
            >
              버리기
            </button>
          </StatusRow>
        </div>
      ))}
    </div>
  )
}

/** 꺼져 있으면 아무것도 그리지 않고 저장소도 열지 않는다 */
export function LargeUploadStatus() {
  return largeUploadClientEnabled ? <Status /> : null
}
