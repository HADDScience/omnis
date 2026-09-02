"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon, Attachment01Icon, Cancel01Icon, PlusSignIcon, Task01Icon, AtIcon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SLASH_COMMANDS } from "./slash-command-parser"

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
  onSend: (content: string, files?: File[]) => Promise<void>
  disabled?: boolean
  tasks?: { id: string; name: string; slug: string }[]
  files?: { id: string; name: string; path: string; mimeType: string }[]
  /** @멘션 대상. 없으면 사람 멘션이 동작하지 않는다. */
  users?: { id: string; name: string }[]
}

/** 후보 종류별 삽입 접두사 */
const PREFIX: Record<MentionItem["type"], string> = {
  command: "/",
  task: "#",
  user: "@",
  file: "@",
}

export function MessageInput({ onSend, disabled, tasks = [], files = [], users = [] }: MessageInputProps) {
  const [content, setContent] = useState("")
  const [sending, setSending] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [uploadingIdx, setUploadingIdx] = useState<Set<number>>(new Set())
  const [previews, setPreviews] = useState<Map<number, string>>(new Map())
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionType, setMentionType] = useState<"task" | "user" | "command" | null>(null)
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 자동완성 후보 계산
  useEffect(() => {
    if (!mentionType) {
      setMentionItems([])
      return
    }

    const query = mentionQuery.toLowerCase()

    if (mentionType === "command") {
      setMentionItems(
        SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(query)).map((c) => ({
          id: c.name.slice(1),
          label: c.name,
          hint: c.description,
          type: "command" as const,
        }))
      )
    } else if (mentionType === "task") {
      setMentionItems(
        tasks
          .filter((t) => t.name.toLowerCase().includes(query) || t.slug.toLowerCase().includes(query))
          .slice(0, 5)
          .map((t) => ({ id: t.slug, label: t.name, hint: `#${t.slug}`, type: "task" as const }))
      )
    } else {
      // 사람이 먼저, 파일이 뒤에. 예전에는 파일만 나와서 @멘션이 사실상 없는 기능이었다.
      const matchedUsers = users
        .filter((u) => u.name.toLowerCase().includes(query))
        .slice(0, 6)
        .map((u) => ({ id: u.name, label: u.name, type: "user" as const }))
      const matchedFiles = files
        .filter((f) => f.name.toLowerCase().includes(query))
        .slice(0, 3)
        .map((f) => ({ id: f.name, label: f.name, type: "file" as const }))
      setMentionItems([...matchedUsers, ...matchedFiles])
    }
    setMentionIndex(0)
  }, [mentionQuery, mentionType, tasks, files, users])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setContent(value)
    syncAutocomplete(value, e.target.selectionStart)
  }

  /** 커서 앞 글자를 보고 어떤 자동완성을 띄울지 정한다. */
  function syncAutocomplete(value: string, cursorPos: number) {
    const textBeforeCursor = value.slice(0, cursorPos)

    // 명령은 맨 앞에서만 — 문장 중간의 "/"는 명령이 아니라 그냥 슬래시다.
    const slashMatch = textBeforeCursor.match(/^\/([^\s]*)$/)
    const hashMatch = textBeforeCursor.match(/#([^\s#@]*)$/)
    const atMatch = textBeforeCursor.match(/@([^\s#@]*)$/)

    if (slashMatch) {
      setMentionType("command")
      setMentionQuery(slashMatch[1])
      setMentionStart(0)
    } else if (hashMatch) {
      setMentionType("task")
      setMentionQuery(hashMatch[1])
      setMentionStart(cursorPos - hashMatch[0].length)
    } else if (atMatch) {
      setMentionType("user")
      setMentionQuery(atMatch[1])
      setMentionStart(cursorPos - atMatch[0].length)
    } else {
      setMentionType(null)
      setMentionQuery("")
      setMentionStart(-1)
    }
  }

  function closeAutocomplete() {
    setMentionType(null)
    setMentionQuery("")
    setMentionStart(-1)
  }

  /** 커서를 특정 위치로 옮긴다. setContent 반영 이후여야 하므로 다음 프레임에 실행. */
  function focusAt(pos: number) {
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(pos, pos)
    })
  }

  function insertMention(item: MentionItem) {
    const prefix = PREFIX[item.type]
    const inserted = `${prefix}${item.id} `
    const before = content.slice(0, mentionStart)
    const after = content.slice(mentionStart + prefix.length + mentionQuery.length)
    setContent(before + inserted + after)
    closeAutocomplete()
    // 삽입한 자리 바로 뒤에 커서를 둔다 — 문장 중간에 넣어도 끝으로 튀지 않게.
    focusAt(before.length + inserted.length)
  }

  /** + 메뉴: 커서 자리에 @ 또는 # 를 넣고 곧바로 목록을 띄운다. */
  function startMention(kind: "user" | "task") {
    const char = kind === "user" ? "@" : "#"
    const pos = textareaRef.current?.selectionStart ?? content.length
    const next = content.slice(0, pos) + char + content.slice(pos)
    setContent(next)
    setMentionType(kind)
    setMentionQuery("")
    setMentionStart(pos)
    focusAt(pos + 1)
  }

  /** + 메뉴: 업무 지시 — "/업무 "를 문장 맨 앞에 붙인다. */
  function startTaskCommand() {
    const next = content.trimStart().startsWith("/업무") ? content : `/업무 ${content.trimStart()}`
    setContent(next)
    closeAutocomplete()
    focusAt(next.length)
  }

  // 파일 추가 + 이미지 프리뷰 생성 + 로딩 표시
  function addFiles(files: File[]) {
    setAttachedFiles((prev) => {
      const startIdx = prev.length
      const newPreviews = new Map(previews)
      const newUploading = new Set(uploadingIdx)
      files.forEach((f, i) => {
        if (f.type.startsWith("image/")) {
          const url = URL.createObjectURL(f)
          newPreviews.set(startIdx + i, url)
        }
        newUploading.add(startIdx + i)
      })
      setPreviews(newPreviews)
      setUploadingIdx(newUploading)
      // 로딩 시뮬레이션 (실제 업로드는 전송 시 수행)
      setTimeout(() => {
        setUploadingIdx((prev) => {
          const next = new Set(prev)
          files.forEach((_, i) => next.delete(startIdx + i))
          return next
        })
      }, 800)
      return [...prev, ...files]
    })
  }

  function removeFile(index: number) {
    const url = previews.get(index)
    if (url) URL.revokeObjectURL(url)
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index))
    setPreviews((prev) => {
      const next = new Map<number, string>()
      prev.forEach((v, k) => {
        if (k < index) next.set(k, v)
        else if (k > index) next.set(k - 1, v)
      })
      return next
    })
  }

  // 붙여넣기 (Ctrl+V / Cmd+V)
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items
    if (!items) return
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const file = items[i].getAsFile()
        if (file) files.push(file)
      }
    }
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  // 드래그앤드롭
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) addFiles(files)
  }

  const handleSend = useCallback(async () => {
    const trimmed = content.trim()
    if (!trimmed && attachedFiles.length === 0) return
    if (sending) return
    setSending(true)
    try {
      await onSend(trimmed || (attachedFiles.length > 0 ? `[파일 ${attachedFiles.length}개 첨부]` : ""), attachedFiles.length > 0 ? attachedFiles : undefined)
      setContent("")
      previews.forEach((url) => URL.revokeObjectURL(url))
      setPreviews(new Map())
      setAttachedFiles([])
      textareaRef.current?.focus()
    } finally {
      setSending(false)
    }
  }, [content, sending, onSend, attachedFiles])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 멘션 팝오버가 열려있을 때
    if (mentionType && mentionItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setMentionIndex((i) => Math.min(i + 1, mentionItems.length - 1))
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setMentionIndex((i) => Math.max(i - 1, 0))
        return
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault()
        insertMention(mentionItems[mentionIndex])
        return
      }
      if (e.key === "Escape") {
        e.preventDefault()
        closeAutocomplete()
        return
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div
      ref={dropRef}
      className={`relative p-4 pt-2 ${dragging ? "ring-2 ring-primary ring-inset rounded-lg bg-primary/5" : ""}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 드래그 오버레이 */}
      {dragging && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/10 pointer-events-none">
          <span className="text-sm font-medium text-primary">파일을 여기에 놓으세요</span>
        </div>
      )}
      {/* 자동완성 목록 — /명령 · #업무 · @사람/파일 이 같은 UI를 쓴다 */}
      {mentionType && mentionItems.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-4 right-4 z-20 mb-1 rounded-md border bg-popover p-1 shadow-md"
        >
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            {mentionType === "command"
              ? "명령어"
              : mentionType === "task"
                ? "업무 선택"
                : "사람 · 파일 선택"}
          </div>
          {mentionItems.map((item, i) => (
            <button
              key={`${item.type}-${item.id}`}
              type="button"
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(item)
              }}
            >
              {item.type === "file" ? (
                <HugeiconsIcon
                  icon={Attachment01Icon}
                  size={12}
                  aria-hidden
                  className="shrink-0 text-muted-foreground"
                />
              ) : item.type === "command" ? null : (
                // 명령은 라벨("/업무")에 이미 슬래시가 들어 있어 접두사를 또 붙이지 않는다
                <span className="w-3 shrink-0 text-center text-xs text-muted-foreground">
                  {PREFIX[item.type]}
                </span>
              )}
              <span className="truncate">{item.label}</span>
              {item.hint && (
                <span className="ml-auto truncate pl-2 text-[11px] text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 첨부 파일 프리뷰 */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {attachedFiles.map((f, i) => {
            const previewUrl = previews.get(i)
            const isUploading = uploadingIdx.has(i)
            return (
              <div key={i} className="relative group">
                {previewUrl ? (
                  <div className="relative h-16 w-16 rounded-md overflow-hidden border">
                    <img src={previewUrl} alt={f.name} className="h-full w-full object-cover" />
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Spinner className="text-white" />
                      </div>
                    )}
                    {!isUploading && (
                      <button
                        onClick={() => removeFile(i)}
                        className="absolute top-0 right-0 bg-black/60 rounded-bl p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <HugeiconsIcon icon={Cancel01Icon} size={10} className="text-white" />
                      </button>
                    )}
                  </div>
                ) : (
                  <Badge variant="secondary" className={`text-[10px] gap-1 pr-1 ${isUploading ? "animate-pulse" : ""}`}>
                    {isUploading && <Spinner className="h-3 w-3" />}
                    {f.name.length > 20 ? f.name.slice(0, 20) + "..." : f.name}
                    {!isUploading && (
                      <button onClick={() => removeFile(i)} className="ml-0.5 hover:bg-muted rounded">
                        <HugeiconsIcon icon={Cancel01Icon} size={10} />
                      </button>
                    )}
                  </Badge>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) {
              addFiles(Array.from(e.target.files))
              e.target.value = ""
            }
          }}
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="추가"
                className="h-9 w-9 shrink-0"
                disabled={disabled || sending}
              />
            }
          >
            <HugeiconsIcon icon={PlusSignIcon} size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className="w-52">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <HugeiconsIcon icon={Attachment01Icon} size={14} aria-hidden />
              파일 업로드
            </DropdownMenuItem>
            <DropdownMenuItem onClick={startTaskCommand}>
              <HugeiconsIcon icon={Task01Icon} size={14} aria-hidden />
              업무 지시
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">/업무</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startMention("user")}>
              <HugeiconsIcon icon={AtIcon} size={14} aria-hidden />
              사람 언급
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">@</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startMention("task")}>
              <HugeiconsIcon icon={Task01Icon} size={14} aria-hidden />
              업무 언급
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">#</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex-1 max-h-[30px]">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="메시지 입력...  / 명령 · @ 사람 · # 업무"
            className="min-h-[30px] resize-none text-sm"
            rows={1}
            disabled={disabled || sending}
          />
        </div>
        <Button
          size="icon"
          onClick={handleSend}
          disabled={(!content.trim() && attachedFiles.length === 0) || sending}
        >
          <HugeiconsIcon icon={SentIcon} size={18} />
        </Button>
      </div>
    </div>
  )
}
