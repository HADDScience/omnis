"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { File01Icon, Image01Icon, Video01Icon } from "@hugeicons/core-free-icons"
import { missingAttachmentLabel, MISSING_ATTACHMENT_NOTE, type MissingAttachment } from "@/lib/kakao-placeholder"

const ICONS = { photo: Image01Icon, video: Video01Icon, file: File01Icon } as const

/**
 * 카톡에서 옮겼지만 실물을 못 받은 첨부 — 진짜 첨부(ImageAttachment · 파일 카드)와 같은 자리 · 같은 크기의 흐린 점선 칸.
 * 눌러도 열리지 않는다. 사진 · 영상 묶음은 장수만 한 칸에 적는다. 영상은 지금 파일 카드로 그려져 파일 칸 모양이다
 */
export function MissingAttachmentTile({ attachment, onPrimary = false }: { attachment: MissingAttachment; onPrimary?: boolean }) {
  const label = missingAttachmentLabel(attachment)
  const tone = onPrimary
    ? "border-white/40 bg-white/10 text-white/80 in-data-[messenger]:border-muted-foreground/35 in-data-[messenger]:bg-muted/40 in-data-[messenger]:text-muted-foreground"
    : "border-muted-foreground/35 bg-muted/40 text-muted-foreground"
  const note = (
    <span data-missing-note className={`block text-[11px] in-data-[messenger]:text-[13px] max-md:in-data-[chat-room-chrome]:text-[12px] ${onPrimary ? "text-white/60 in-data-[messenger]:text-muted-foreground/80" : "text-muted-foreground/80"}`}>
      {MISSING_ATTACHMENT_NOTE}
    </span>
  )
  return (
    <div className="mt-1.5 flex flex-col gap-1.5 max-md:in-data-[chat-room-chrome]:mt-0">
      {attachment.kind === "photo" ? (
        <div
          data-missing-attachment="photo"
          role="img"
          aria-label={`${label} — ${MISSING_ATTACHMENT_NOTE}`}
          title={`${label} — ${MISSING_ATTACHMENT_NOTE}`}
          className={`flex aspect-[4/3] w-[200px] max-w-full cursor-default select-none flex-col items-center justify-center gap-1 rounded-md border border-dashed p-2 text-center opacity-80 in-data-[messenger]:w-[260px] max-md:in-data-[chat-room-chrome]:w-[calc(var(--app-vw)*0.7)] max-md:in-data-[chat-room-chrome]:max-w-none max-md:in-data-[chat-room-chrome]:rounded-[13px] ${tone}`}
        >
          <HugeiconsIcon icon={Image01Icon} size={26} aria-hidden className="opacity-70" />
          <span data-missing-label className="text-[12.5px] font-medium in-data-[messenger]:text-[15px]">{label}</span>
          {note}
        </div>
      ) : (
        <div
          data-missing-attachment={attachment.kind}
          title={`${label} — ${MISSING_ATTACHMENT_NOTE}`}
          className={`flex max-w-[280px] cursor-default select-none items-center gap-2.5 overflow-hidden rounded-lg border border-dashed px-2.5 py-2 opacity-80 in-data-[messenger]:max-w-[340px] in-data-[messenger]:gap-3 in-data-[messenger]:rounded-xl max-md:in-data-[chat-room-chrome]:w-[calc(var(--app-vw)*0.7)] max-md:in-data-[chat-room-chrome]:max-w-none max-md:in-data-[chat-room-chrome]:flex-row-reverse max-md:in-data-[chat-room-chrome]:gap-[10px] max-md:in-data-[chat-room-chrome]:rounded-[13px] max-md:in-data-[chat-room-chrome]:p-[10px] ${tone}`}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/70 in-data-[messenger]:size-[44px] in-data-[messenger]:[&_svg]:size-[22px] max-md:in-data-[chat-room-chrome]:size-[40px] max-md:in-data-[chat-room-chrome]:rounded-full">
            <HugeiconsIcon icon={ICONS[attachment.kind]} size={17} aria-hidden className="opacity-70" />
          </span>
          <span className="min-w-0 flex-1">
            <span data-missing-label className="block truncate text-[12.5px] font-medium in-data-[messenger]:text-[15px] max-md:in-data-[chat-room-chrome]:line-clamp-2 max-md:in-data-[chat-room-chrome]:whitespace-normal max-md:in-data-[chat-room-chrome]:font-normal max-md:in-data-[chat-room-chrome]:leading-[20px] max-md:in-data-[chat-room-chrome]:[overflow-wrap:anywhere]">{label}</span>
            {note}
          </span>
        </div>
      )}
    </div>
  )
}

/** 첨부를 그리지 않는 좁은 자리(업무 상세의 대화 카드 · 방 열기 전 저장본)에서 쓰는 한 줄 — 아이콘 · 이름 · 「카톡 원본에만 있음」 */
export function MissingAttachmentInline({ attachment, className = "" }: { attachment: MissingAttachment; className?: string }) {
  const label = missingAttachmentLabel(attachment)
  return (
    <span
      data-missing-attachment={attachment.kind}
      title={`${label} — ${MISSING_ATTACHMENT_NOTE}`}
      className={`inline-flex max-w-full cursor-default select-none items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/35 bg-muted/40 px-2 py-1 align-middle text-muted-foreground opacity-80 ${className}`}
    >
      <HugeiconsIcon icon={ICONS[attachment.kind]} size={14} aria-hidden className="shrink-0 opacity-70" />
      <span data-missing-label className="min-w-0 truncate font-medium">{label}</span>
      <span data-missing-note className="shrink-0 text-[0.8em] text-muted-foreground/80">· {MISSING_ATTACHMENT_NOTE}</span>
    </span>
  )
}
