"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Doc01Icon, Download04Icon, File01Icon, Pdf01Icon, Ppt01Icon, Refresh01Icon, Share08Icon, Xls01Icon, ZipIcon } from "@hugeicons/core-free-icons"
import {
  cancelFileDownload,
  fileThumb,
  openDownloadedFile,
  preloadFile,
  shareFile,
  startFileDownload,
  useFileState,
  type CardFile,
} from "@/lib/file-cache/client"
import { fileSizeLabel, progressLabel, progressRatio } from "@/lib/file-cache/rules"

/** 확장자로 아이콘과 짧은 형식 이름 — 파일 카드에서 무엇인지 먼저 보이게 */
function fileKind(name: string): { icon: typeof File01Icon; label: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (ext === "pdf") return { icon: Pdf01Icon, label: "PDF" }
  if (["ppt", "pptx", "key"].includes(ext)) return { icon: Ppt01Icon, label: "PPT" }
  if (["xls", "xlsx", "csv"].includes(ext)) return { icon: Xls01Icon, label: ext.toUpperCase() }
  if (["doc", "docx", "hwp", "hwpx", "txt", "md"].includes(ext)) return { icon: Doc01Icon, label: ext.toUpperCase() }
  if (["zip", "7z", "rar"].includes(ext)) return { icon: ZipIcon, label: ext.toUpperCase() }
  return { icon: File01Icon, label: ext ? ext.toUpperCase() : "파일" }
}

/** 받는 중 원 — 단추 테두리에 진행률을 그린다 */
function Ring({ ratio }: { ratio: number }) {
  const r = 20
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 44 44" aria-hidden className="absolute inset-0 size-full -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" strokeWidth="2.5" className="stroke-foreground/10" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - ratio)}
        className="stroke-primary transition-[stroke-dashoffset] duration-150 motion-reduce:transition-none"
      />
    </svg>
  )
}

/**
 * 채팅의 파일 한 장 — 카톡 파일 메시지처럼. 폰 · PC · 업무 스레드 · 옴니스 방이 같은 카드를 쓴다.
 *
 *   [공유]  ┌ 이름(두 줄) ─────────── [받기 ↓] ┐
 *           └ PDF · 5.1MB ──────────────────────┘
 *
 * 누르면 바로 열지 않고 카드 안에서 받는다(진행률 원 · 아래 막대 · 취소). 받은 뒤 다시 누르면 연다 —
 * 폰은 공유 시트(미리보기 · 저장), PC 는 새 탭(PDF · 사진) 또는 저장. 받은 상태는 기기에 남는다(lib/file-cache).
 * 받은 PDF · 사진은 오른쪽 칸이 미리보기가 된다. 공유 단추는 말풍선 바깥 옆(내 글은 왼쪽, 남의 글은 오른쪽)
 */
export function FileCard({ file, uploading = false, mine = false }: { file: CardFile; uploading?: boolean; mine?: boolean }) {
  const state = useFileState(file.id)
  const kind = fileKind(file.name)
  const [thumb, setThumb] = useState<string | null>(null)
  const done = state.phase === "done"

  useEffect(() => {
    if (!done || uploading) return
    let live = true
    preloadFile(file)
    void fileThumb(file).then((url) => live && setThumb(url))
    return () => {
      live = false
    }
    // 같은 파일이면 다시 부르지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, uploading, file.id])

  const primary = () => {
    if (uploading) return
    if (state.phase === "done") void openDownloadedFile(file)
    else if (state.phase !== "downloading") void startFileDownload(file)
  }
  const ratio = progressRatio(state.bytes, state.total)
  const meta = uploading
    ? "업로드 중..."
    : state.phase === "downloading"
      ? progressLabel(state.bytes, state.total)
      : state.phase === "error"
        ? "받지 못했어요 · 다시 눌러 받기"
        : `${kind.label} · ${fileSizeLabel(file.size)}`
  const label = state.phase === "done" ? "열기" : state.phase === "downloading" ? "받기 취소" : state.phase === "error" ? "다시 받기" : "받기"

  return (
    <div data-attachment-file-row className={`flex w-fit max-w-full items-center gap-[6px] ${mine ? "flex-row-reverse self-end" : ""}`}>
      <div
        data-attachment-file
        data-file-state={uploading ? "uploading" : state.phase}
        title={file.name}
        className={`glass relative flex w-[min(340px,100%)] items-center gap-[10px] overflow-hidden rounded-[18px] p-[10px] pl-[14px] text-foreground max-md:in-data-[chat-room-chrome]:w-[calc(var(--app-vw)*0.7)] max-md:in-data-[chat-room-chrome]:rounded-[13px] max-md:in-data-[chat-room-chrome]:pl-[12px] ${uploading ? "opacity-70" : ""}`}
      >
        {uploading && <div className="absolute inset-y-0 left-0 bg-primary/15 animate-[gauge_1.5s_ease-in-out_infinite]" />}
        <button
          type="button"
          data-file-open
          disabled={uploading}
          onClick={(e) => {
            e.stopPropagation()
            primary()
          }}
          className="relative min-w-0 flex-1 text-left outline-none after:absolute after:inset-[-10px] after:content-[''] focus-visible:after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring disabled:cursor-default"
        >
          <span data-attachment-name className="line-clamp-2 text-[15px] leading-[20px] [overflow-wrap:anywhere] max-md:in-data-[chat-room-chrome]:text-[15px]">
            {file.name}
          </span>
          <span data-file-meta aria-live={state.phase === "downloading" ? "polite" : undefined} className="mt-[2px] block text-[13px] leading-[18px] text-muted-foreground tabular-nums">
            {meta}
          </span>
        </button>
        {done && thumb && !uploading ? (
          <button
            type="button"
            data-file-action="open"
            aria-label={`${file.name} 열기`}
            onClick={(e) => {
              e.stopPropagation()
              primary()
            }}
            className="relative size-[56px] shrink-0 overflow-hidden rounded-[10px] bg-white ring-1 ring-black/5"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- 기기에서 그린 미리보기(data URL) */}
            <img data-file-thumb src={thumb} alt="" className="size-full object-cover object-top" />
          </button>
        ) : (
          <button
            type="button"
            data-file-action={state.phase === "downloading" ? "cancel" : state.phase === "done" ? "open" : "download"}
            aria-label={`${file.name} ${label}`}
            title={label}
            disabled={uploading}
            onClick={(e) => {
              e.stopPropagation()
              if (state.phase === "downloading") cancelFileDownload(file.id)
              else primary()
            }}
            className="relative flex size-[44px] shrink-0 items-center justify-center rounded-full bg-foreground/[0.07] text-foreground transition-colors hover:bg-foreground/[0.12] active:scale-95 disabled:opacity-50 dark:bg-white/10 dark:hover:bg-white/15"
          >
            {state.phase === "downloading" && <Ring ratio={ratio} />}
            <HugeiconsIcon
              icon={state.phase === "downloading" ? Cancel01Icon : state.phase === "done" ? kind.icon : state.phase === "error" ? Refresh01Icon : Download04Icon}
              size={state.phase === "downloading" ? 16 : 21}
              aria-hidden
            />
          </button>
        )}
        {state.phase === "downloading" && (
          <span aria-hidden data-file-progress className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground/5">
            <span className="block h-full bg-primary transition-[width] duration-150 motion-reduce:transition-none" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </span>
        )}
      </div>
      {!uploading && (
        <button
          type="button"
          data-file-share
          aria-label={`${file.name} 공유`}
          title="공유"
          onClick={async (e) => {
            e.stopPropagation()
            const r = await shareFile(file)
            if (r === "copied") toast.success("파일 주소를 복사했어요")
            else if (r === "failed") toast.error("공유하지 못했어요")
          }}
          className="glass flex size-[36px] shrink-0 items-center justify-center rounded-full text-foreground/80 transition-transform active:scale-95 touch-hit"
        >
          <HugeiconsIcon icon={Share08Icon} size={17} aria-hidden />
        </button>
      )}
    </div>
  )
}
