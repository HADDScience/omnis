"use client"

// 방 첨부 받기 진행 — 화면을 옮겨도 하단에 작게 남는다. 채팅 방 안에서는 입력창 위로 올린다(겹치면 입력창 글과 섞여 보인다)(lib/room-download/client.ts). 유리 알약 · 라이트/다크 모두 glass 토큰을 쓴다.
import { useSyncExternalStore } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Download04Icon, CheckmarkCircle02Icon, Alert02Icon } from "@hugeicons/core-free-icons"
import { cancelDownload, dismissDownload, downloadServerSnapshot, downloadSnapshot, shareReady, subscribeDownloads, type DownloadJob } from "@/lib/room-download/client"
import { formatBytes } from "@/lib/room-drawer"

function percent(j: DownloadJob) {
  if (j.totalBytes > 0) return Math.min(100, Math.round((j.bytes / j.totalBytes) * 100))
  return j.total > 0 ? Math.round((j.done / j.total) * 100) : 0
}

function Row({ job: j }: { job: DownloadJob }) {
  const pct = percent(j)
  const active = j.status === "preparing" || j.status === "running"
  const icon = j.status === "done" ? CheckmarkCircle02Icon : j.status === "error" ? Alert02Icon : Download04Icon
  return (
    <div data-room-download={j.status} className="glass pointer-events-auto flex min-w-0 items-center gap-2.5 rounded-full py-1.5 pr-1.5 pl-3.5 text-[13px] shadow-lg">
      <HugeiconsIcon icon={icon} size={16} aria-hidden className={j.status === "error" ? "text-destructive" : "text-primary"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="min-w-0 truncate font-medium">{j.title}</span>
          {active && (
            <span className="shrink-0 tabular-nums text-muted-foreground" data-room-download-percent>
              {j.status === "preparing" ? "준비 중" : `${j.done}/${j.total} · ${pct}%`}
            </span>
          )}
        </div>
        {active && j.totalBytes > 0 && (
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${j.title} 받는 중 · ${formatBytes(j.totalBytes)}`}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
          </div>
        )}
        {!active && j.note && <p className="truncate text-[12px] text-muted-foreground">{j.note}</p>}
      </div>
      {j.status === "ready-share" && (
        <button type="button" onClick={() => void shareReady(j.id)} className="touch-target h-9 shrink-0 rounded-full bg-primary px-3.5 text-[13px] font-medium text-primary-foreground">
          사진에 저장
        </button>
      )}
      <button
        type="button"
        onClick={() => (active || j.status === "ready-share" ? cancelDownload(j.id) : dismissDownload(j.id))}
        aria-label={active ? `${j.title} 받기 멈추기` : "닫기"}
        className="touch-target flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-foreground/10"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} aria-hidden />
      </button>
    </div>
  )
}

export function RoomDownloadStatus() {
  const jobs = useSyncExternalStore(subscribeDownloads, downloadSnapshot, downloadServerSnapshot)
  if (jobs.length === 0) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-room-download-status
      className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--nav-offset-bottom,0px)+12px)] z-[var(--z-banner)] mx-auto flex max-w-sm flex-col gap-1.5 md:bottom-5 [body:has([data-chat-room-chrome])_&]:bottom-[calc(var(--nav-offset-bottom,0px)+6.5rem)]"
    >
      {jobs.map((j) => (
        <Row key={j.id} job={j} />
      ))}
    </div>
  )
}
