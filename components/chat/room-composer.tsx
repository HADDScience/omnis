"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ArrowUp01Icon, Attachment01Icon, Cancel01Icon, Folder01Icon, PlusSignIcon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { FileInfo } from "@/components/chat/message-list"
import { enterSends, isTouchTyping } from "@/lib/enter-to-send"
import { cn } from "@/lib/utils"
import { NasFilePicker } from "./nas-file-picker"

/**
 * 메신저의 입력창 하나 — 사람 · 전사 · 업무 방(message-input.tsx) · 옴니스 방(omnis-room.tsx Composer) ·
 * 방이 오기 전 입력창(cached-room-preview.tsx)이 모두 이것을 그린다. 모양과 Enter · 끌어 놓기 · 붙여넣기 · 높이 늘리기는 여기 한 곳이다.
 *
 * 방마다 다른 것은 켜고 끈다 — ＋ 메뉴(plus) · 첨부(onFiles) · 자동완성(onKeyIntercept · overlay) · 답변 중지(onStop) · 글자 수(maxLength) · 무지개(accent).
 * 무엇을 어디로 보내는지는 모른다 — 옴니스 방에는 자동완성을 넘기지 않아 `/업무` · `@이름` 이 그냥 글로 옴니스에게 간다.
 *
 * 크기는 메신저 안(`data-messenger`)에서 키운다. 그 밖(오른쪽 패널 · 업무 상세)은 좁은 칸에 맞는 작은 크기다.
 */
export function RoomComposer({
  textareaRef,
  value,
  onChange,
  onSend,
  canSend,
  busy = false,
  onStop,
  stopping = false,
  placeholder,
  ariaLabel,
  accent = false,
  longPlaceholder = false,
  autoFocus,
  disabled = false,
  bordered = true,
  hint,
  maxLength,
  plus,
  above,
  overlay,
  onFiles,
  onKeyIntercept,
  textareaProps,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  value: string
  onChange: (value: string, caret: number) => void
  /** Enter · 보내기 단추. canSend 가 false 면 부르지 않는다 */
  onSend: () => void
  canSend: boolean
  /** 보내는 중 · 답하는 중 — 보내기 자리가 도는 표시가 된다. 입력칸은 그대로 써 둘 수 있다 */
  busy?: boolean
  /** 답하는 동안 보내기 자리를 「답변 중지」 로 바꾼다(옴니스 방) */
  onStop?: () => void
  /** 중지를 눌러 서버가 멈추기를 기다리는 중 */
  stopping?: boolean
  placeholder: string
  ariaLabel: string
  /** 보내기 단추의 무지개 — 옴니스(AI)에게 보내는 입력창만 */
  accent?: boolean
  /** 안내 문구가 길어 폰 폭에서 넘치는 방 — 메신저 안에서 문구만 줄인다 */
  longPlaceholder?: boolean
  autoFocus?: boolean
  disabled?: boolean
  /** 위 칸(답장 줄)과 함께 감싼 곳은 감싼 쪽이 선을 긋는다 */
  bordered?: boolean
  /** 입력줄 아래 안내 — 물리 키보드로 쓰는 넓은 메신저에서만 보인다 */
  hint?: string
  /** 80% 를 넘으면 글자 수를, 넘치면 빨갛게 보인다. 막는 것은 canSend 쪽이다 */
  maxLength?: number
  /** 알약 안 왼쪽(＋ 메뉴). 없으면 글자 앞 여백 */
  plus?: ReactNode
  /** 입력줄 위(첨부 칩) */
  above?: ReactNode
  /** 입력창 위로 뜨는 것(자동완성 목록) */
  overlay?: ReactNode
  /** 붙여넣은 · 끌어 놓은 파일. 없으면 받지 않는다 */
  onFiles?: (files: File[]) => void
  /** 보내기보다 먼저 키를 본다(자동완성 목록). true 면 처리한 것이다 */
  onKeyIntercept?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => boolean
  /** 입력칸에 더 붙일 것 — 방이 오기 전 입력창의 커서 · 포커스 기록 */
  textareaProps?: Pick<React.ComponentProps<"textarea">, "onSelect" | "onFocus" | "onBlur"> & { "data-entry-composer"?: boolean }
}) {
  const [dragging, setDragging] = useState(false)

  // 내용만큼 늘린다 — 상한은 CSS 의 max-height(크기별로 다르다), 넘으면 안에서 민다
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const limit = parseFloat(getComputedStyle(el).maxHeight)
    el.style.height = `${Number.isNaN(limit) ? el.scrollHeight : Math.min(el.scrollHeight, limit)}px`
  }, [value, textareaRef])

  const tooLong = maxLength !== undefined && value.length > maxLength

  /**
   * 보내고 나서도 입력칸에 머문다 — 이어서 쓴다. PC 는 언제나 되돌린다.
   * 폰은 쓰던 중이면 단추의 onMouseDown 이 포커스를 지켜 키보드가 그대로고, 내려 둔 키보드를 여기서 올리지는 않는다.
   */
  function sendAndStay() {
    onSend()
    if (!isTouchTyping()) textareaRef.current?.focus()
  }

  return (
    <div
      className={cn(
        "relative shrink-0 bg-background px-2.5 pt-2 pb-3 in-data-[messenger]:px-3 in-data-[messenger]:sm:px-6",
        bordered && "border-t",
        dragging && "bg-primary/5",
      )}
      onDragOver={
        onFiles
          ? (e) => {
              e.preventDefault()
              setDragging(true)
            }
          : undefined
      }
      onDragLeave={onFiles ? () => setDragging(false) : undefined}
      onDrop={
        onFiles
          ? (e) => {
              e.preventDefault()
              setDragging(false)
              const files = Array.from(e.dataTransfer.files)
              if (files.length) onFiles(files)
            }
          : undefined
      }
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-primary/10">
          <span className="text-sm font-medium text-primary">파일을 여기에 놓으세요</span>
        </div>
      )}
      {overlay}
      <div className="mx-auto w-full max-w-[760px]">
        {above}
        {/* 한 줄일 때 글자와 단추의 세로 가운데가 같게 — 입력칸 최소 높이 = 단추 높이(PC 32px · 터치 44px · 메신저 48px),
            남는 높이는 위아래 여백으로. 여러 줄로 늘면 단추는 아래에 붙는다(items-end). 2026-10-29 폰에서 글자가 아래로 처졌다 */}
        <div
          data-composer-pill
          className={cn(
            "flex items-end gap-2 rounded-[22px] border bg-card py-1 pr-1 shadow-[0_2px_8px_rgba(0,0,0,0.04)] focus-within:border-border-strong in-data-[messenger]:gap-2.5 in-data-[messenger]:rounded-[32px] in-data-[messenger]:py-1.5 in-data-[messenger]:pr-1.5",
            plus ? "pl-1 in-data-[messenger]:pl-1.5" : "pl-3.5 in-data-[messenger]:pl-[22px]",
          )}
        >
          {plus}
          <textarea
            {...textareaProps}
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value, e.target.selectionStart)}
            onPaste={
              onFiles
                ? (e) => {
                    // 붙여넣은 파일(스크린샷 등)
                    const files = Array.from(e.clipboardData?.files ?? [])
                    if (files.length) {
                      e.preventDefault()
                      onFiles(files)
                    }
                  }
                : undefined
            }
            onKeyDown={(e) => {
              if (onKeyIntercept?.(e)) return
              // PC 는 Enter 보내기 · Shift+Enter 줄바꿈, 폰은 Enter 가 줄바꿈이고 보내기는 단추로만(lib/enter-to-send.ts)
              if (enterSends(e, isTouchTyping())) {
                e.preventDefault()
                if (canSend) sendAndStay()
              }
            }}
            rows={1}
            enterKeyHint="enter"
            autoFocus={autoFocus}
            disabled={disabled}
            aria-label={ariaLabel}
            placeholder={placeholder}
            className={cn(
              "max-h-40 min-h-[32px] min-w-0 flex-1 resize-none bg-transparent py-[5px] text-[14px] leading-[22px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:py-[11px] [@media(pointer:coarse)]:text-[16px] in-data-[messenger]:max-h-48 in-data-[messenger]:min-h-[48px]! in-data-[messenger]:py-[11px]! in-data-[messenger]:text-[17px]! in-data-[messenger]:leading-[26px]!",
              longPlaceholder && "in-data-[messenger]:placeholder:text-[15px]",
            )}
          />
          {/* 답하는 동안은 같은 자리 · 같은 크기의 중지 단추(■) — ChatGPT · Gemini 처럼. 입력칸은 그대로 써 둘 수 있다 */}
          {busy && onStop ? (
            <Button
              size="icon"
              onClick={onStop}
              disabled={stopping}
              aria-label="답변 중지"
              title="답변 중지"
              data-agent-stop
              className={cn("touch-target size-[32px] shrink-0 rounded-full in-data-[messenger]:size-[48px]", accent && "ai-rainbow-border")}
            >
              {stopping ? <Spinner /> : <span aria-hidden className="size-[10px] rounded-[2px] bg-current in-data-[messenger]:size-[15px]" />}
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={sendAndStay}
              // 누르는 순간 입력칸이 포커스를 잃지 않게 한다 — 폰 키보드가 내려갔다 올라오지 않는다
              onMouseDown={(e) => e.preventDefault()}
              disabled={!canSend || disabled}
              aria-label="보내기"
              title="보내기 (Enter)"
              className={cn("touch-target size-[32px] shrink-0 rounded-full in-data-[messenger]:size-[48px]", accent && "ai-rainbow-border")}
            >
              {busy ? <Spinner /> : <HugeiconsIcon icon={ArrowUp01Icon} size={16} aria-hidden className="in-data-[messenger]:h-[24px]! in-data-[messenger]:w-[24px]!" />}
            </Button>
          )}
        </div>
        <div className="mt-1 flex justify-between gap-2 px-1 text-[10.5px] text-muted-foreground in-data-[messenger]:text-[12.5px]">
          {hint && <span className="hidden in-data-[messenger]:sm:inline [@media(pointer:coarse)]:hidden!">{hint}</span>}
          <span className={cn("ml-auto tabular-nums", tooLong && "font-medium text-destructive")}>
            {maxLength !== undefined && value.length > maxLength * 0.8 ? `${value.length}/${maxLength}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}

/** 파일을 고르는 메뉴 항목에 넘기는 것 — 없으면(데모 · 첨부를 받지 않는 곳) 메뉴에 파일 항목이 없다 */
export interface ComposerPlusFiles {
  onFiles: (files: File[]) => void
  onNas: (entry: { path: string; name: string; size?: number }) => void
  /** 시놀로지 고르기 창을 밖에서도 연다(「상한 초과」 알림의 단추). 없으면 메뉴로만 연다 */
  nasOpen?: boolean
  onNasOpenChange?: (open: boolean) => void
}

/** 알약 안 왼쪽 ＋ — 파일 업로드 · 시놀로지 연결에 방마다 다른 항목(children)을 잇는다 */
export function ComposerPlus({ files, disabled, children }: { files?: ComposerPlusFiles; disabled?: boolean; children?: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [ownNasOpen, setOwnNasOpen] = useState(false)
  const nasOpen = files?.nasOpen ?? ownNasOpen
  const setNasOpen = files?.onNasOpenChange ?? setOwnNasOpen
  return (
    <>
      {files && (
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          data-composer-file-input
          onChange={(e) => {
            if (e.target.files) {
              files.onFiles(Array.from(e.target.files))
              e.target.value = ""
            }
          }}
        />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label="추가"
              className="touch-target size-[32px] shrink-0 rounded-full in-data-[messenger]:size-[48px]!"
              disabled={disabled}
            />
          }
        >
          <HugeiconsIcon icon={PlusSignIcon} size={18} className="in-data-[messenger]:h-[26px]! in-data-[messenger]:w-[26px]!" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="top" className="w-52">
          {files && (
            <DropdownMenuItem onClick={() => inputRef.current?.click()}>
              <HugeiconsIcon icon={Attachment01Icon} size={14} aria-hidden />
              파일 업로드
              <span className="ml-auto text-[10px] text-muted-foreground">4MB 이하</span>
            </DropdownMenuItem>
          )}
          {files && (
            <DropdownMenuItem onClick={() => setNasOpen(true)}>
              <HugeiconsIcon icon={Folder01Icon} size={14} aria-hidden />
              시놀로지 파일 연결
            </DropdownMenuItem>
          )}
          {children}
        </DropdownMenuContent>
      </DropdownMenu>
      {files && (
        <NasFilePicker
          open={nasOpen}
          onOpenChange={setNasOpen}
          onPick={(entry) => files.onNas({ path: entry.path, name: entry.name, size: entry.size ?? undefined })}
        />
      )}
    </>
  )
}

export interface PickedFile {
  key: string
  name: string
  size: number
  mimeType: string
  /** 이미지 미리보기(내 기기에서 고른 것만) */
  preview?: string
  status: "uploading" | "done" | "error"
  error?: string
  /** 올린 뒤 받은 파일 — 옴니스 질문에 이 id 를 붙인다 */
  file?: FileInfo
}

/** 입력창 위 칩 — 이미지는 작은 미리보기, 나머지는 이름. 올리는 중 · 실패를 보이고 ✕ 로 뺀다 */
export function AttachChips({ items, onRemove }: { items: PickedFile[]; onRemove: (key: string) => void }) {
  if (items.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5 px-1 in-data-[messenger]:gap-2" data-composer-attachments>
      {items.map((i) => (
        <div
          key={i.key}
          data-attach-status={i.status}
          title={i.status === "error" ? i.error : i.name}
          className={cn(
            "flex max-w-[220px] items-center gap-1.5 rounded-full border bg-card py-0.5 pr-0.5 pl-1 text-[11.5px] in-data-[messenger]:max-w-[260px] in-data-[messenger]:gap-2 in-data-[messenger]:py-1 in-data-[messenger]:pl-1.5 in-data-[messenger]:text-[14px]",
            i.status === "error" && "border-destructive/50 text-destructive",
          )}
        >
          {i.preview ? (
            <span className="relative size-6 shrink-0 overflow-hidden rounded-full in-data-[messenger]:size-8">
              {/* eslint-disable-next-line @next/next/no-img-element -- 내 기기의 blob 미리보기 */}
              <img src={i.preview} alt="" className="size-full object-cover" />
            </span>
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground in-data-[messenger]:size-8">
              <HugeiconsIcon icon={i.mimeType === "" ? Folder01Icon : Attachment01Icon} size={13} aria-hidden />
            </span>
          )}
          <span className="min-w-0 truncate">{i.name}</span>
          {i.status === "uploading" && (
            <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
              <Spinner className="size-3" />
              <span className="sr-only sm:not-sr-only">올리는 중</span>
            </span>
          )}
          {i.status === "error" && (
            <span className="flex shrink-0 items-center gap-0.5">
              <HugeiconsIcon icon={Alert02Icon} size={13} aria-hidden />
              실패
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(i.key)}
            aria-label={`${i.name} 빼기`}
            className="touch-target flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted in-data-[messenger]:size-8"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
