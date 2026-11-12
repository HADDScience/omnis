"use client"

import { useEffect, useRef, useState, type RefObject } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  Copy01Icon,
  GitBranchIcon,
  Link01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Share08Icon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  Tick02Icon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { stripCitations } from "@/lib/answer-clipboard"
import { answerLink, answerTimeLabel } from "@/lib/answer-actions"
import { BASE_PATH } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { clipFromElement, writeClip } from "./answer-copy"

const SOON = "곧 제공됩니다"

const iconButton =
  "touch-hit inline-flex size-[40px] shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:size-8 aria-pressed:text-foreground"

/**
 * 옴니스 답 아래 동작 줄 — 복사 · 좋아요/싫어요 · 소리내어 읽기 · 공유 · 더 보기(응답 시각 · 다시 생성 · 대화 브랜치).
 * 답이 다 흐른 뒤(방 글로 들어온 답)에만 붙는다 — 흐르는 중의 답(LiveOmnis)에는 없다.
 * 공유는 사내 링크만이다 — 공개 링크 · 바깥 SNS 공유는 만들지 않는다(답에 사내 정보가 담긴다).
 */
export function AnswerActions({
  messageId,
  roomId,
  roomName,
  content,
  createdAt,
  answerRef,
  preview,
  onRegenerate,
  onShareSession,
}: {
  messageId: string
  roomId: string | null
  roomName?: string
  /** 답 원문(마크다운) — 복사의 text/plain */
  content: string
  createdAt: string
  /** 답 본문을 품은 요소 — 복사의 text/html 은 화면에 그려진 답(표 · 굵게 · 목록)에서 만든다 */
  answerRef: RefObject<HTMLElement | null>
  /** 공유 창의 답 미리보기 */
  preview: React.ReactNode
  /** 같은 질문을 다시 묻는다. 없으면 「응답 다시 생성」 이 흐리게 */
  onRegenerate?: () => void
  /** 이 대화(세션)를 사람 · 방에 공유하는 창을 연다 — 주인에게만. 없으면 공유 창에 바로가기를 두지 않는다 */
  onShareSession?: () => void
}) {
  const [copied, setCopied] = useState(false)
  // TODO(answer-feedback): 좋아요 · 싫어요를 저장할 표가 아직 없다 — 지금은 이 화면에서만 표시한다
  const [vote, setVote] = useState<"up" | "down" | null>(null)
  const [sharing, setSharing] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    const body = answerRef.current?.querySelector("[data-omnis-answer]") ?? answerRef.current
    // 화면에 그린 답에서 세 형식 — 표는 html · RTF 로는 표, 글(text/plain)로는 탭 · 줄바꿈(엑셀 · 구글 시트가 칸으로 나눈다).
    // 2026-11-11 까지 글은 마크다운 원문(| 칸 | 칸 |)이었다 — 표를 붙이면 칸이 나뉘지 않았다. 화면을 못 찾으면 원문에서 각주만 뺀다
    const clip = body ? clipFromElement(body) : null
    try {
      await writeClip(clip?.text ? clip : { html: clip?.html ?? "", text: stripCitations(content).trim() })
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error("복사하지 못했습니다")
    }
  }

  const time = answerTimeLabel(createdAt)

  return (
    <div data-answer-actions role="toolbar" aria-label="답 동작" className="-ml-1.5 mt-1 flex max-w-full flex-wrap items-center gap-0.5 md:gap-0">
      <button type="button" data-answer-copy className={iconButton} aria-label={copied ? "복사됨" : "답 복사"} title={copied ? "복사됨" : "복사"} onClick={() => void copy()}>
        <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} size={16} aria-hidden />
      </button>
      {copied && <span role="status" data-answer-copied className="mr-1 text-[12px] text-muted-foreground">복사됨</span>}
      <button
        type="button"
        data-answer-vote="up"
        className={cn(iconButton, vote === "up" && "bg-muted text-foreground")}
        aria-label="좋은 답"
        aria-pressed={vote === "up"}
        title="좋은 답"
        onClick={() => setVote((v) => (v === "up" ? null : "up"))}
      >
        <HugeiconsIcon icon={ThumbsUpIcon} size={16} aria-hidden />
      </button>
      <button
        type="button"
        data-answer-vote="down"
        className={cn(iconButton, vote === "down" && "bg-muted text-foreground")}
        aria-label="아쉬운 답"
        aria-pressed={vote === "down"}
        title="아쉬운 답"
        onClick={() => setVote((v) => (v === "down" ? null : "down"))}
      >
        <HugeiconsIcon icon={ThumbsDownIcon} size={16} aria-hidden />
      </button>
      <button type="button" data-answer-read className={iconButton} aria-label="소리내어 읽기" title="소리내어 읽기" onClick={() => toast(SOON)}>
        <HugeiconsIcon icon={VolumeHighIcon} size={16} aria-hidden />
      </button>
      {roomId && (
        <button type="button" data-answer-share className={iconButton} aria-label="공유" title="공유" onClick={() => setSharing(true)}>
          <HugeiconsIcon icon={Share08Icon} size={16} aria-hidden />
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger data-answer-more className={iconButton} aria-label="더 보기" title="더 보기">
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56" data-answer-menu>
          {time && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel data-answer-time>{time}</DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem className="touch-target md:min-h-0" disabled={!onRegenerate} onClick={() => onRegenerate?.()}>
            <HugeiconsIcon icon={Refresh01Icon} size={15} aria-hidden />
            <span className="flex-1">응답 다시 생성</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden className="text-muted-foreground" />
          </DropdownMenuItem>
          <DropdownMenuItem className="touch-target md:min-h-0" onClick={() => toast(SOON)}>
            <HugeiconsIcon icon={GitBranchIcon} size={15} aria-hidden />
            <span className="flex-1">대화 브랜치</span>
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden className="text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {roomId && (
        <ShareDialog
          open={sharing}
          onOpenChange={setSharing}
          roomId={roomId}
          roomName={roomName}
          messageId={messageId}
          preview={preview}
          onShareSession={onShareSession ? () => { setSharing(false); onShareSession() } : undefined}
        />
      )}
    </div>
  )
}

function ShareDialog({
  open,
  onOpenChange,
  roomId,
  roomName,
  messageId,
  preview,
  onShareSession,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  roomName?: string
  messageId: string
  preview: React.ReactNode
  onShareSession?: () => void
}) {
  const [copied, setCopied] = useState(false)
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(answerLink(window.location.origin, roomId, messageId, BASE_PATH))
      setCopied(true)
      toast.success("링크를 복사했습니다")
    } catch {
      toast.error("링크를 복사하지 못했습니다")
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setCopied(false) }}>
      <DialogContent data-answer-share-dialog className="grid max-h-[min(85svh,640px)] w-full max-w-[min(560px,calc(var(--app-vw,100vw)-2rem))] grid-rows-[auto_1fr_auto] gap-4 sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{roomName || "옴니스 대화"}</DialogTitle>
          <DialogDescription>이 답을 사내 링크로 보냅니다</DialogDescription>
        </DialogHeader>
        <div data-answer-share-preview className="min-h-0 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-[13px] [&_.omnis-md]:text-[13px]">
          {preview}
        </div>
        <div className="flex flex-col items-center gap-3">
          <p data-answer-share-note className="text-center text-[12.5px] text-muted-foreground">
            이 메시지 링크 — 회사 구성원만 볼 수 있음(로그인 필요). 옴니스 대화는 대화에 들어 있는 사람(연 사람 · 공유받은 사람)만 열 수 있습니다.
          </p>
          <div className="flex flex-col items-center gap-1">
            <Button type="button" data-answer-copy-link variant="secondary" size="icon-lg" className="size-12 rounded-full" aria-label="링크 복사" onClick={() => void copyLink()}>
              <HugeiconsIcon icon={copied ? Tick02Icon : Link01Icon} size={20} aria-hidden />
            </Button>
            <span className="text-[12px] text-muted-foreground">{copied ? "복사됨" : "링크 복사"}</span>
          </div>
          {onShareSession && (
            <Button type="button" variant="outline" data-answer-share-session className="h-11 md:h-9" onClick={onShareSession}>
              이 대화를 공유하기
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
