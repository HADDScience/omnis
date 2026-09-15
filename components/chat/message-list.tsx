"use client"

import { useLayoutEffect, useRef } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Spinner } from "@/components/ui/spinner"
import { format } from "date-fns"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Doc01Icon,
  File01Icon,
  Pdf01Icon,
  Ppt01Icon,
  Task01Icon,
  Xls01Icon,
  ZipIcon,
} from "@hugeicons/core-free-icons"
import { TASK_STATUS_LABELS, TASK_STATUS_COLORS, PRIORITY_LABELS } from "@/lib/constants"
import { layoutMessages, tidyBody } from "@/lib/chat-layout"
import { AuthorAvatar, DayDivider, MessageTime } from "@/components/chat/message-parts"

import { apiUrl } from "@/lib/base-path"
export interface FileInfo {
  id: string
  name: string
  path: string
  size: number
  mimeType: string
  _uploading?: boolean
}

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  _isSystem?: boolean
  author: { id: string; name: string }
  task?: {
    id: string
    name: string
    slug: string
    status?: string
    priority?: string
    deadline?: string | null
    owner?: { id: string; name: string } | null
    _count?: { checklists: number }
  } | null
  files?: FileInfo[]
}

interface TaskRef {
  id: string
  name: string
  slug: string
}

interface MessageListProps {
  messages: Message[]
  currentUserId: string
  selectionMode?: boolean
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
  tasks?: TaskRef[]
  processingSlug?: string | null
  /** 위로 스크롤 시 이전 메시지 로드 요청 */
  onLoadOlder?: () => void
  /** 더 불러올 이전 메시지가 있는지 */
  hasMoreOlder?: boolean
  /** 이전 메시지 로딩 중 */
  loadingOlder?: boolean
}

export function MessageList({
  messages,
  currentUserId,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  tasks = [],
  processingSlug,
  onLoadOlder,
  hasMoreOlder = false,
  loadingOlder = false,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevFirstIdRef = useRef<string | null>(null)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)

  // 이전 메시지(prepend)면 스크롤 위치 유지, 그 외(새 메시지·초기 로드)는 맨 아래로
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const firstId = messages[0]?.id ?? null
    const prevFirstId = prevFirstIdRef.current
    const isPrepend =
      prevFirstId != null &&
      firstId !== prevFirstId &&
      messages.some((m) => m.id === prevFirstId)

    if (isPrepend && anchorRef.current) {
      // prepend된 높이만큼 스크롤을 내려 시야를 그대로 유지
      el.scrollTop =
        el.scrollHeight - anchorRef.current.height + anchorRef.current.top
      anchorRef.current = null
    } else {
      el.scrollTop = el.scrollHeight
    }
    prevFirstIdRef.current = firstId
  }, [messages])

  function handleScroll() {
    const el = scrollRef.current
    if (!el || !onLoadOlder) return
    if (el.scrollTop < 80 && hasMoreOlder && !loadingOlder) {
      // prepend 직전 스크롤 상태를 기록 → useLayoutEffect에서 위치 복원
      anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      onLoadOlder()
    }
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        아직 메시지가 없습니다. 대화를 시작해보세요.
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4"
    >
      <div role="log" aria-label="채팅 메시지" className="flex flex-col py-3">
        {loadingOlder && (
          <div className="flex justify-center py-1">
            <Spinner className="h-4 w-4" />
          </div>
        )}
        {!hasMoreOlder && !loadingOlder && (
          <div className="py-1 text-center text-[11px] text-muted-foreground">
            대화의 시작
          </div>
        )}
        {layoutMessages(
          messages.map((m, i) => ({
            ...m,
            isEvent:
              m.content.startsWith("__TASK_CREATED__:") ||
              !!m._isSystem ||
              m.author.id === "system" ||
              m.content.startsWith("🤖"),
            // 같은 업무 태그가 묶음 안 말풍선마다 반복되지 않게 — 다음 메시지가 다른 업무일 때만 붙인다
            nextTaskId: messages[i + 1]?.task?.id ?? null,
          })),
        ).map((row) => {
          if (row.type === "day") return <DayDivider key={row.key} label={row.label} />
          const msg = row.message
          const isMe = msg.author.id === currentUserId || msg.author.id === "me"
          const isSelected = selectedIds?.has(msg.id) ?? false

          // 업무 생성 카드 — content가 `__TASK_CREATED__:<taskId>` 형태
          if (msg.content.startsWith("__TASK_CREATED__:")) {
            return (
              <TaskCreatedCard
                key={msg.id}
                task={msg.task ?? null}
                fallbackId={msg.content.slice("__TASK_CREATED__:".length)}
                createdAt={msg.createdAt}
              />
            )
          }

          // 시스템 메시지 (구분선 스타일)
          if (msg._isSystem || msg.author.id === "system" || msg.content.startsWith("🤖")) {
            return (
              <div key={msg.id} className="flex items-center gap-3 py-1">
                <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {msg.content.startsWith("🤖") ? msg.content : `🤖 ${msg.content}`}
                </span>
                <div className="flex-1 border-t border-dashed border-muted-foreground/20" />
              </div>
            )
          }

          const mine = isMe && !selectionMode
          return (
            <div
              key={msg.id}
              className={`group/msg flex gap-2.5 ${mine ? "flex-row-reverse" : ""} ${
                row.groupStart ? "mt-3" : "mt-0.5"
              } ${selectionMode ? "cursor-pointer" : ""} ${isSelected ? "rounded-lg bg-primary/5 ring-1 ring-primary/20 p-1" : ""}`}
              onClick={selectionMode ? () => onToggleSelect?.(msg.id) : undefined}
            >
              {selectionMode && (
                <div className="flex items-start pt-1 shrink-0">
                  <Checkbox checked={isSelected} />
                </div>
              )}
              {!mine && !selectionMode && (
                // 묶음 안 줄은 아바타 자리를 비워 본문 줄을 맞춘다
                row.groupStart ? <AuthorAvatar name={msg.author.name} size={30} className="mt-5" /> : <span className="w-[30px] shrink-0" />
              )}
              <div
                className={`flex min-w-0 max-w-[78%] flex-col gap-1 ${mine ? "items-end" : ""}`}
              >
                {!isMe && row.groupStart && (
                  <span className="px-0.5 text-[12px] font-semibold text-foreground/80">
                    {msg.author.name}
                  </span>
                )}
                <div
                  className={`rounded-2xl px-3 py-2 text-[13.5px] leading-[1.6] ${
                    mine ? "bg-primary text-primary-foreground" : "bg-muted"
                  } ${mine && !row.groupStart ? "rounded-tr-md" : ""} ${!mine && !row.groupStart ? "rounded-tl-md" : ""} ${
                    msg.isTaskInstruction ? "ring-2 ring-primary/30" : ""
                  }`}
                >
                  <p className="whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">
                    <MessageContent content={tidyBody(msg.content)} tasks={tasks} isMe={mine} />
                  </p>
                  {msg.files && msg.files.length > 0 && <MessageFiles files={msg.files} onPrimary={mine} />}
                </div>
                {(row.groupEnd || (msg.task && msg.nextTaskId !== msg.task.id)) && (
                  <div className="flex items-center gap-2 px-0.5">
                    {row.groupEnd && <MessageTime iso={msg.createdAt} className="text-[10.5px]" />}
                    {msg.task && (row.groupEnd || msg.nextTaskId !== msg.task.id) && (
                      <Link href={`/tasks/${msg.task.id}`} onClick={(e) => e.stopPropagation()} title={msg.task.name}>
                        <Badge variant="outline" className="max-w-[180px] cursor-pointer truncate text-[10px] transition-colors hover:bg-primary/10">
                          #{msg.task.slug}
                        </Badge>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {processingSlug && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 animate-pulse">
            <div className="h-2 w-2 rounded-full bg-primary animate-bounce" />
            <span className="text-xs text-muted-foreground">
              <span className="font-medium text-primary">#{processingSlug}</span> 업무를 분석하고 있습니다...
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 본문에서 링크로 만들 것들.
 *
 * 실제 대화를 보면 사람들이 URL(148건)과 `Z:\HADD Science\...` 같은 NAS 경로(27건)를
 * 그대로 붙여넣는다. 평문으로 두면 매번 복사해서 탐색기에 붙여야 한다.
 *
 * 순서가 중요하다 — URL 을 먼저 잡아야 주소 안의 `#`·`@` 가 멘션으로 오인되지 않는다.
 */
const TOKEN_RE = new RegExp(
  [
    "(https?://[^\\s<>\"']+)",                        // URL
    "([A-Za-z]:\\\\HADD Science\\\\[^\\n]*)",         // Z:\HADD Science\...
    "(\\\\\\\\[\\w.-]+\\\\HADD Science\\\\[^\\n]*)",   // \\서버\HADD Science\...
    // 멘션. 앞 글자가 영숫자·점이면 이메일 지역부라 사람 멘션이 아니다(a@b.com).
    "(#[a-z0-9가-힣-]+|(?<![A-Za-z0-9._%+-])@[a-z0-9가-힣]+)",
  ].join("|"),
  "gi",
)

/** 경로 끝에 붙은 문장부호는 경로가 아니다. */
function trimPathTail(p: string): string {
  return p.replace(/[\s.,!?)\]}"']+$/, "")
}

/**
 * NAS 경로가 어디서 끝나는지 정한다.
 *
 * 폴더 이름에 공백이 흔해서("62. HADD 홈페이지") 공백만으로는 끊을 수 없다.
 * 대신 **마지막 구분자 뒤 조각**에서 한국어 조사가 시작되면 거기서 자른다 —
 * "…\00. 회의록 에 넣어놨어요" 처럼 경로 뒤에 말이 이어지는 경우다.
 */
function cutPathTail(raw: string): string {
  const p = trimPathTail(raw)
  const sep = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"))
  if (sep < 0) return p
  const last = p.slice(sep + 1)
  // 조사·서술어가 공백 뒤에 붙은 자리를 찾는다
  const m = last.match(/\s(?:에|에서|에다|로|으로|을|를|은|는|이|가|와|과|의|도|만|까지|부터|한테|께)(?:\s|$)/)
  return m ? p.slice(0, sep + 1 + m.index!) : p
}

const fileSizeLabel = (size: number) =>
  size < 1024 ? `${size}B` : size < 1048576 ? `${Math.round(size / 1024)}KB` : `${(size / 1048576).toFixed(1)}MB`

/** 확장자로 아이콘과 짧은 형식 이름 — 파일 카드에서 무엇인지 먼저 보이게 */
function fileKind(name: string): { icon: typeof File01Icon; label: string; tone: string } {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  if (ext === "pdf") return { icon: Pdf01Icon, label: "PDF", tone: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-300" }
  if (["ppt", "pptx", "key"].includes(ext)) return { icon: Ppt01Icon, label: "PPT", tone: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300" }
  if (["xls", "xlsx", "csv"].includes(ext)) return { icon: Xls01Icon, label: ext.toUpperCase(), tone: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" }
  if (["doc", "docx", "hwp", "hwpx", "txt", "md"].includes(ext)) return { icon: Doc01Icon, label: ext.toUpperCase(), tone: "text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300" }
  if (["zip", "7z", "rar"].includes(ext)) return { icon: ZipIcon, label: ext.toUpperCase(), tone: "text-violet-700 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300" }
  return { icon: File01Icon, label: ext ? ext.toUpperCase() : "파일", tone: "text-muted-foreground bg-muted" }
}

/** 메시지에 붙은 파일 — 이미지는 미리보기, 나머지는 형식 아이콘 · 이름 · 크기 카드. 채팅과 업무 스레드가 같이 쓴다. */
export function MessageFiles({ files, onPrimary = false }: { files: FileInfo[]; onPrimary?: boolean }) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f) => {
        const isImage = f.mimeType?.startsWith("image/")
        const uploading = f._uploading

        if (isImage) {
          return (
            <a
              key={f.id}
              href={uploading ? undefined : apiUrl(f.path)}
              target="_blank"
              rel="noopener noreferrer"
              className={`block rounded-md overflow-hidden max-w-[200px] border ${uploading ? "opacity-60" : "hover:opacity-90"} transition-opacity`}
              onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
            >
              <img src={apiUrl(f.path)} alt={f.name} className="w-full h-auto" loading="lazy" />
              <div className="relative px-1.5 py-0.5 text-[10px] text-muted-foreground bg-background/80 truncate overflow-hidden">
                {uploading && (
                  <div className="absolute inset-0 bg-primary/20 animate-[gauge_1.5s_ease-in-out_infinite]" />
                )}
                <span className="relative">{uploading ? "업로드 중..." : f.name}</span>
              </div>
            </a>
          )
        }
        const kind = fileKind(f.name)
        return (
          <a
            key={f.id}
            href={uploading ? undefined : apiUrl(f.path)}
            target="_blank"
            rel="noopener noreferrer"
            title={f.name}
            className={`relative flex max-w-[280px] items-center gap-2.5 overflow-hidden rounded-lg border px-2.5 py-2 transition-colors ${
              onPrimary ? "border-white/25 bg-white/10 hover:bg-white/15" : "bg-background hover:bg-muted/60"
            } ${uploading ? "opacity-70" : ""}`}
            onClick={(e) => { if (uploading) e.preventDefault(); e.stopPropagation() }}
          >
            {uploading && (
              <div className="absolute inset-y-0 left-0 bg-primary/15 animate-[gauge_1.5s_ease-in-out_infinite]" />
            )}
            <span className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${onPrimary ? "bg-white/20 text-white" : kind.tone}`}>
              <HugeiconsIcon icon={kind.icon} size={17} aria-hidden />
            </span>
            <span className="relative min-w-0 flex-1">
              <span className={`block truncate text-[12.5px] font-medium ${onPrimary ? "text-white" : "text-foreground"}`}>{f.name}</span>
              <span className={`block text-[11px] ${onPrimary ? "text-white/70" : "text-muted-foreground"}`}>
                {uploading ? "업로드 중..." : `${kind.label} · ${fileSizeLabel(f.size)}`}
              </span>
            </span>
          </a>
        )
      })}
    </div>
  )
}

export function MessageContent({ content, tasks, isMe = false }: { content: string; tasks: TaskRef[]; isMe?: boolean }) {
  // 링크 · 경로는 밑줄 글자, @사람 · #업무는 옅은 칩 — 본문과 한눈에 구분된다
  const mentionClass = isMe
    ? "font-medium text-white/90 underline decoration-white/40 hover:decoration-white"
    : "font-medium text-blue-700 dark:text-blue-300 hover:underline"
  const chipClass = isMe
    ? "rounded bg-white/20 px-1 py-px font-medium text-white hover:bg-white/30"
    : "rounded bg-blue-50 px-1 py-px font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-900/60"

  const parts: React.ReactNode[] = []
  const regex = TOKEN_RE
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }

    const token = match[0]

    // 바깥 링크 — 새 탭에서 연다
    if (/^https?:\/\//i.test(token)) {
      const url = trimPathTail(token)
      parts.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={mentionClass}
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>,
      )
      if (token.length > url.length) parts.push(token.slice(url.length))
      lastIndex = match.index + match[0].length
      continue
    }

    // NAS 경로 — 옴니스가 중계해 연다. 브라우저는 NAS 에 직접 붙지 못한다.
    if (/HADD Science/i.test(token) && /[\\/]/.test(token)) {
      const raw = cutPathTail(token)
      parts.push(
        <Link
          key={match.index}
          href={`/omnis/nas?path=${encodeURIComponent(raw)}`}
          className={mentionClass}
          title="사내 NAS 에서 열기"
          onClick={(e) => e.stopPropagation()}
        >
          {raw}
        </Link>,
      )
      if (token.length > raw.length) parts.push(token.slice(raw.length))
      lastIndex = match.index + match[0].length
      continue
    }

    if (token.startsWith("#")) {
      const slug = token.slice(1)
      const task = tasks.find((t) => t.slug === slug)
      if (task) {
        parts.push(
          <Link
            key={match.index}
            href={`/tasks/${task.id}`}
            className={chipClass}
            title={task.name}
            onClick={(e) => e.stopPropagation()}
          >
            {token}
          </Link>
        )
      } else {
        parts.push(<span key={match.index} className={chipClass}>{token}</span>)
      }
    } else {
      parts.push(<span key={match.index} className={chipClass}>{token}</span>)
    }
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return <>{parts}</>
}

/** 업무 생성 시 채팅에 표시되는 프리뷰 카드 */
function TaskCreatedCard({
  task,
  fallbackId,
  createdAt,
}: {
  task: Message["task"]
  fallbackId: string
  createdAt: string
}) {
  const href = `/tasks/${task?.id ?? fallbackId}`
  const statusLabel = task?.status ? TASK_STATUS_LABELS[task.status] ?? task.status : null
  const deadlineLabel = task?.deadline ? format(new Date(task.deadline), "M월 d일") : null
  const checklistCount = task?._count?.checklists ?? 0

  return (
    <div className="flex flex-col items-center gap-1 py-1">
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className="group flex w-full max-w-[88%] flex-col gap-2 rounded-xl border border-primary/25 bg-primary/[0.04] px-3.5 py-3 transition-colors hover:border-primary/45 hover:bg-primary/[0.07]"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
          <HugeiconsIcon icon={Task01Icon} size={13} />
          새 업무가 생성되었습니다
        </div>

        <div className="text-[13px] font-semibold leading-snug text-foreground">
          {task?.name ?? "업무"}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {task?.slug && (
            <Badge variant="outline" className="text-[10px]">
              #{task.slug}
            </Badge>
          )}
          {statusLabel && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                (task?.status && TASK_STATUS_COLORS[task.status]) ||
                "bg-muted text-muted-foreground"
              }`}
            >
              {statusLabel}
            </span>
          )}
          {task?.priority && (
            <span className="text-[10px] text-muted-foreground">
              {PRIORITY_LABELS[task.priority] ?? task.priority}
            </span>
          )}
        </div>

        {(task?.owner || deadlineLabel || checklistCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-muted-foreground">
            {task?.owner && <span>담당 {task.owner.name}</span>}
            {deadlineLabel && <span>마감 {deadlineLabel}</span>}
            {checklistCount > 0 && <span>체크리스트 {checklistCount}개</span>}
          </div>
        )}

        <span className="text-[10.5px] font-medium text-primary opacity-70 transition-opacity group-hover:opacity-100">
          업무 상세 보기 →
        </span>
      </Link>
      <span className="text-[10px] text-muted-foreground">
        {format(new Date(createdAt), "HH:mm")}
      </span>
    </div>
  )
}
