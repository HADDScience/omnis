"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { AtIcon, Attachment01Icon, Task01Icon } from "@hugeicons/core-free-icons"
import { SLASH_COMMANDS } from "./slash-command-parser"
import { IS_DEMO } from "@/lib/demo"
import { toast } from "sonner"
import { attachLimitBytes, isLargeUpload } from "@/lib/large-upload/rules"
import { resolveHandoff } from "@/lib/chat-entry"
import { composerTrigger, type ComposerTrigger } from "@/lib/composer-trigger"
import { isTouchTyping } from "@/lib/enter-to-send"
import { useComposerHandoff } from "@/hooks/use-composer-handoff"
import { useChatDraft } from "@/hooks/use-chat-draft"
import { reportIncident } from "@/lib/report-client-error"
import { AttachChips, ComposerPlus, RoomComposer, type PickedFile } from "./room-composer"

/** 자동완성 후보. `/`(명령) · `#`(업무) · `@`(사람·파일) 세 갈래가 같은 목록 UI를 쓴다. */
interface MentionItem {
  /** 실제로 입력창에 삽입될 값 */
  id: string
  label: string
  /** 오른쪽에 흐리게 붙는 보조 설명 */
  hint?: string
  type: "task" | "user" | "file" | "command"
}

interface MessageInputProps {
  /**
   * 실패하면 던진다 — 입력한 글과 첨부를 입력창에 되돌린다.
   * nasPaths: 「NAS 파일 연결」 로 고른 파일의 NAS 경로. 올리지 않고 POST /api/files/nas 로 잇는다.
   */
  onSend: (content: string, files?: File[], nasPaths?: string[]) => Promise<void>
  disabled?: boolean
  tasks?: { id: string; name: string; slug: string; status?: string }[]
  files?: { id: string; name: string; path: string; mimeType: string }[]
  /** @멘션 대상. 없으면 사람 멘션이 동작하지 않는다. */
  users?: { id: string; name: string }[]
  /** `/업무` 명령과 「업무 지시」 메뉴. 업무 스레드처럼 명령을 받을 곳이 없으면 끈다. */
  commands?: boolean
  /** 파일 업로드 · NAS 연결 · 붙여넣기 · 끌어 놓기 */
  attachments?: boolean
  /** + 메뉴의 「업무 언급(#)」. 사람끼리 방은 업무 목록을 받지 않아 끈다 */
  taskMentions?: boolean
  placeholder?: string
  ariaLabel?: string
  /** 메신저 방 키(room: · task:) — 방이 오기 전 loading 입력창에 쓴 글을 이어받는다(lib/chat-entry.ts). 메신저 밖은 비운다 */
  handoffKey?: string
}

/** 고른 첨부 하나 — 칩에 그릴 것과 보낼 때 넘길 것 */
interface Attached {
  item: PickedFile
  /** 내 기기에서 고른 파일 — 보낼 때 올린다 */
  raw?: File
  /** 시놀로지에서 고른 파일 — 보낼 때 잇는다 */
  nasPath?: string
}

/** # 자동완성에 보일 업무 — 진행 중인 것이 먼저, 완료된 업무는 뒤에 「완료」 표시와 함께 */
const TASK_SUGGESTIONS = 8

/** 후보 종류별 삽입 접두사 */
const PREFIX: Record<MentionItem["type"], string> = {
  command: "/",
  task: "#",
  user: "@",
  file: "@",
}

const NO_TASKS: NonNullable<MessageInputProps["tasks"]> = []
const NO_FILES: NonNullable<MessageInputProps["files"]> = []
const NO_USERS: NonNullable<MessageInputProps["users"]> = []

let seq = 0

/**
 * 사람 · 전사 · 업무 방의 입력창 — 모양과 Enter 는 공통 입력창(room-composer.tsx), 여기는 이 방들에만 있는 것:
 * `/명령` · `#업무` · `@사람` 자동완성과 보낼 때 올리는 첨부. 글은 보내는 즉시 비우고(말풍선이 먼저 뜬다) 실패하면 되돌린다.
 */
export function MessageInput({
  onSend,
  disabled,
  tasks = NO_TASKS,
  files = NO_FILES,
  users = NO_USERS,
  commands = true,
  attachments = true,
  taskMentions = true,
  placeholder = "메시지 입력...  / 명령 · @ 사람 · # 업무",
  ariaLabel = "메시지 입력",
  handoffKey,
}: MessageInputProps) {
  const [content, setContent] = useState("")
  /** 같은 순간 두 번 — 입력칸이 비는 것은 다음 그리기에야 보여, 표시 없이는 같은 글이 두 번 나간다. 그릴 때마다 푼다 */
  const justSent = useRef(false)
  useEffect(() => {
    justSent.current = false
  })
  /** 되돌아온 글 — 실패가 잇따라도 먼저 쓴 글이 위에 오게, 그 뒤에 잇는다 */
  const returned = useRef("")
  const [attached, setAttached] = useState<Attached[]>([])
  const [nasPickerOpen, setNasPickerOpen] = useState(false)
  const [trigger, setTrigger] = useState<ComposerTrigger | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // loading 입력창에서 쓴 글을 받고, 눌러 둔 보내기는 바로 보낸다. 보내지 못하면 그 글을 입력칸에 되돌린다
  useComposerHandoff(handoffKey, textareaRef, (h) => {
    const { send: queued, text } = resolveHandoff(h, Date.now())
    setContent(text)
    if (queued === null) return
    if (disabled) {
      putBack(queued)
      return
    }
    onSend(queued)
      .catch(() => putBack(queued))
      .finally(() => {
        if (h.focused) requestAnimationFrame(() => textareaRef.current?.focus())
      })
  })
  // 방마다 쓰던 글을 기기에 둔다 — 나갔다 오거나 새로 고친 뒤 되살리고, 보내서 비면 지운다(lib/chat-draft.ts). 이어받은 글 다음에 본다
  useChatDraft(handoffKey, content, setContent)

  /** 보내지 못한 글을 입력칸 맨 앞으로 — 그 사이 쓴 글은 뒤에 남는다. 실패가 잇따르면 먼저 쓴 글이 위다 */
  function putBack(text: string) {
    if (!text) return
    setContent((c) => {
      const prefix = returned.current && c.startsWith(returned.current) ? returned.current : ""
      const rest = c.slice(prefix.length).replace(/^\n/, "")
      const head = prefix ? `${prefix}\n${text}` : text
      returned.current = head
      return rest ? `${head}\n${rest}` : head
    })
  }

  // 데모에는 NAS 가 없어 파일을 받지 않는다
  const noFiles = IS_DEMO || !attachments

  const mentionItems = useMemo<MentionItem[]>(() => {
    if (!trigger) return []
    const query = trigger.query.toLowerCase()
    if (trigger.kind === "command") {
      return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(query)).map((c) => ({
        id: c.name.slice(1),
        label: c.name,
        hint: c.description,
        type: "command" as const,
      }))
    }
    if (trigger.kind === "task") {
      // 완료된 업무도 언급할 수 있어야 한다(지난 결과를 가리키는 일이 많다). 다만 진행 중인 것에 밀리지 않게
      // 자리를 나눈다 — 진행 중 최대 5개, 남는 자리에 완료.
      const matched = tasks.filter((t) => t.name.toLowerCase().includes(query) || t.slug.toLowerCase().includes(query))
      const active = matched.filter((t) => t.status !== "DONE").slice(0, 5)
      const done = matched.filter((t) => t.status === "DONE").slice(0, TASK_SUGGESTIONS - active.length)
      return [...active, ...done].map((t) => ({
        id: t.slug,
        label: t.name,
        hint: t.status === "DONE" ? `완료 · #${t.slug}` : `#${t.slug}`,
        type: "task" as const,
      }))
    }
    // 사람이 먼저, 파일이 뒤에. 예전에는 파일만 나와서 @멘션이 사실상 없는 기능이었다.
    const matchedUsers = users
      .filter((u) => u.name.toLowerCase().includes(query))
      .slice(0, 6)
      .map((u) => ({ id: u.name, label: u.name, type: "user" as const }))
    const matchedFiles = files
      .filter((f) => f.name.toLowerCase().includes(query))
      .slice(0, 3)
      .map((f) => ({ id: f.name, label: f.name, type: "file" as const }))
    return [...matchedUsers, ...matchedFiles]
  }, [trigger, tasks, files, users])

  function openTrigger(next: ComposerTrigger | null) {
    setTrigger(next)
    setMentionIndex(0)
  }

  function handleChange(value: string, caret: number) {
    setContent(value)
    openTrigger(composerTrigger(value.slice(0, caret), { commands }))
  }

  /** 커서를 특정 위치로 옮긴다. setContent 반영 이후여야 하므로 다음 프레임에 실행. */
  function focusAt(pos: number) {
    // iOS 는 탭 동작 안에서 준 포커스에만 키보드를 연다 — 먼저 주고, 글자가 그려진 뒤 커서를 놓는다
    textareaRef.current?.focus()
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  function insertMention(item: MentionItem) {
    if (!trigger) return
    const prefix = PREFIX[item.type]
    const inserted = `${prefix}${item.id} `
    const before = content.slice(0, trigger.start)
    const after = content.slice(trigger.start + prefix.length + trigger.query.length)
    setContent(before + inserted + after)
    openTrigger(null)
    // 삽입한 자리 바로 뒤에 커서를 둔다 — 문장 중간에 넣어도 끝으로 튀지 않게.
    focusAt(before.length + inserted.length)
  }

  /** + 메뉴: 커서 자리에 @ 또는 # 를 넣고 곧바로 목록을 띄운다. */
  function startMention(kind: "user" | "task") {
    const char = kind === "user" ? "@" : "#"
    const pos = textareaRef.current?.selectionStart ?? content.length
    setContent(content.slice(0, pos) + char + content.slice(pos))
    openTrigger({ kind, query: "", start: pos })
    focusAt(pos + 1)
  }

  /** + 메뉴: 업무 지시 — "/업무 "를 문장 맨 앞에 붙인다. */
  function startTaskCommand() {
    const next = content.trimStart().startsWith("/업무") ? content : `/업무 ${content.trimStart()}`
    setContent(next)
    openTrigger(null)
    focusAt(next.length)
  }

  // 파일 추가 + 이미지 프리뷰 생성
  function addFiles(picked: File[]) {
    // 데모에는 NAS가 없어 파일을 받지 않는다 — 붙여넣기·드래그로 들어와도 조용히 무시한다.
    if (noFiles) return
    // 상한을 넘는 파일은 보낼 때 Vercel 이 이유 없이 끊는다 — 고르는 순간 이유와 함께 거른다(2026-09-17)
    const limit = attachLimitBytes()
    const tooLarge = picked.filter((f) => f.size > limit)
    if (tooLarge.length > 0) {
      const limitMb = Math.floor(limit / 1024 / 1024)
      // 이미 NAS 에 있으면 연결하면 되고, 아니면 NAS 에 올린 뒤 연결한다 — 어느 쪽이든 같은 버튼으로 간다
      toast.error(`${limitMb}MB 가 넘는 파일은 바로 올릴 수 없습니다`, {
        description: `${tooLarge.map((f) => `「${f.name}」 ${(f.size / 1024 / 1024).toFixed(1)}MB`).join(" · ")} — 시놀로지에 올린 뒤 「시놀로지 파일 연결」 로 다시 첨부해 주세요`,
        duration: 12_000,
        action: { label: "시놀로지 파일 연결", onClick: () => setNasPickerOpen(true) },
      })
      for (const f of tooLarge) {
        reportIncident({
          kind: "upload_too_large",
          message: `첨부 상한(${limitMb}MB) 초과로 업로드를 막았다`,
          size: f.size,
          fileName: f.name,
        })
      }
    }
    const fresh = picked
      .filter((f) => f.size <= limit)
      .map<Attached>((f) => ({
        raw: f,
        item: {
          key: `file-${++seq}`,
          name: f.name,
          size: f.size,
          mimeType: f.type || "application/octet-stream",
          // 큰 사진을 입력창에 그리면 폰이 전체를 디코딩한다
          preview: f.type.startsWith("image/") && !isLargeUpload(f.size) ? URL.createObjectURL(f) : undefined,
          // 실제 업로드는 보낼 때 — 고르는 것만으로는 기다릴 일이 없다
          status: "done",
        },
      }))
    if (fresh.length > 0) setAttached((prev) => [...prev, ...fresh])
  }

  function addNas(entry: { path: string; name: string; size?: number }) {
    setAttached((prev) =>
      prev.some((a) => a.nasPath === entry.path)
        ? prev
        : [...prev, { nasPath: entry.path, item: { key: `nas-${++seq}`, name: entry.name, size: entry.size ?? 0, mimeType: "", status: "done" } }],
    )
  }

  function removeAttached(key: string) {
    setAttached((prev) => {
      const gone = prev.find((a) => a.item.key === key)
      if (gone?.item.preview) URL.revokeObjectURL(gone.item.preview)
      return prev.filter((a) => a.item.key !== key)
    })
  }

  async function handleSend() {
    const trimmed = content.trim()
    if ((!trimmed && attached.length === 0) || justSent.current) return
    justSent.current = true
    returned.current = ""
    const sent = attached
    const raws = sent.flatMap((a) => (a.raw ? [a.raw] : []))
    const nasPaths = sent.flatMap((a) => (a.nasPath ? [a.nasPath] : []))
    // 말풍선이 바로 뜨므로 입력칸은 바로 비운다. 사진을 올리는 동안에도 다음 글을 쓰고 보낼 수 있다 — 순서는 onSend 쪽 줄이 지킨다
    setContent("")
    setAttached([])
    openTrigger(null)
    try {
      // 글 없이 첨부만 보내면 본문을 비운다 — 카드만 보인다(목록 · 인용 · 알림은 「파일 N개」, lib/attachment-text.ts)
      await onSend(trimmed, raws.length > 0 ? raws : undefined, nasPaths.length > 0 ? nasPaths : undefined)
      sent.forEach((a) => a.item.preview && URL.revokeObjectURL(a.item.preview))
    } catch {
      // 보내지 못했다 — 쓴 글과 첨부를 되돌린다. 알림은 onSend 쪽이 띄운다.
      putBack(trimmed)
      setAttached((prev) => [...sent, ...prev])
      // 폰은 내려 둔 키보드를 다시 올리지 않는다
      if (!isTouchTyping()) textareaRef.current?.focus()
    }
  }

  /** 자동완성 목록이 열려 있으면 방향키 · Enter · Esc 는 목록의 것이다 */
  function handleListKeys(e: React.KeyboardEvent<HTMLTextAreaElement>): boolean {
    // 한글 조합 중의 Enter · 방향키는 글자를 확정하는 키다 — 후보 고르기 · 보내기로 가로채지 않는다
    if (e.nativeEvent.isComposing || e.keyCode === 229) return true
    if (!trigger || mentionItems.length === 0) return false
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setMentionIndex((i) => Math.min(i + 1, mentionItems.length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault()
      insertMention(mentionItems[mentionIndex])
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      openTrigger(null)
      return true
    }
    return false
  }

  return (
    <RoomComposer
      textareaRef={textareaRef}
      value={content}
      onChange={handleChange}
      onSend={handleSend}
      canSend={content.trim().length > 0 || attached.length > 0}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      longPlaceholder
      disabled={disabled}
      // 답장 줄과 함께 감싼 쪽(chat-panel · thread-composer)이 선을 긋는다
      bordered={false}
      hint="Enter 보내기 · Shift+Enter 줄바꿈"
      onFiles={noFiles ? undefined : addFiles}
      onKeyIntercept={handleListKeys}
      above={<AttachChips items={attached.map((a) => a.item)} onRemove={removeAttached} />}
      plus={
        <ComposerPlus
          disabled={disabled}
          files={noFiles ? undefined : { onFiles: addFiles, onNas: addNas, nasOpen: nasPickerOpen, onNasOpenChange: setNasPickerOpen }}
          actions={[
            ...(commands ? [{ key: "task-command", icon: Task01Icon, label: "업무 지시", shortcut: "/업무", onSelect: startTaskCommand }] : []),
            { key: "mention-user", icon: AtIcon, label: "사람 언급", shortcut: "@", onSelect: () => startMention("user") },
            // 사람끼리 방은 업무 목록을 받지 않는다(commands 와 함께 끈다)
            ...(taskMentions ? [{ key: "mention-task", icon: Task01Icon, label: "업무 언급", shortcut: "#", onSelect: () => startMention("task") }] : []),
          ]}
        />
      }
      overlay={
        // 자동완성 목록 — /명령 · #업무 · @사람/파일 이 같은 UI를 쓴다
        trigger && mentionItems.length > 0 ? (
          <div data-composer-autocomplete className="absolute right-4 bottom-full left-4 z-20 mb-1 rounded-md border bg-popover p-1 shadow-md">
            <div className="px-2 py-1 text-[10px] text-muted-foreground in-data-[messenger]:px-3 in-data-[messenger]:text-[12.5px]">
              {trigger.kind === "command" ? "명령어" : trigger.kind === "task" ? "업무 선택" : "사람 · 파일 선택"}
            </div>
            {mentionItems.map((item, i) => (
              <button
                key={`${item.type}-${item.id}`}
                type="button"
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm in-data-[messenger]:gap-2.5 in-data-[messenger]:rounded-lg in-data-[messenger]:px-3 in-data-[messenger]:py-2.5 in-data-[messenger]:text-[16px] ${
                  i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  insertMention(item)
                }}
              >
                {item.type === "file" ? (
                  <HugeiconsIcon icon={Attachment01Icon} size={12} aria-hidden className="shrink-0 text-muted-foreground" />
                ) : item.type === "command" ? null : (
                  // 명령은 라벨("/업무")에 이미 슬래시가 들어 있어 접두사를 또 붙이지 않는다
                  <span className="w-3 shrink-0 text-center text-xs text-muted-foreground">{PREFIX[item.type]}</span>
                )}
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground in-data-[messenger]:text-[13px]">{item.hint}</span>}
              </button>
            ))}
          </div>
        ) : null
      }
    />
  )
}
