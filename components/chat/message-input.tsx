"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { HugeiconsIcon } from "@hugeicons/react"
import { SentIcon, Attachment01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { Spinner } from "@/components/ui/spinner"

interface MentionItem {
  id: string
  label: string
  type: "task" | "user" | "file"
}

interface MessageInputProps {
  onSend: (content: string, files?: File[]) => Promise<void>
  disabled?: boolean
  tasks?: { id: string; name: string; slug: string }[]
  users?: { id: string; name: string }[]
  files?: { id: string; name: string; path: string; mimeType: string }[]
}

export function MessageInput({ onSend, disabled, tasks = [], users = [], files = [] }: MessageInputProps) {
  const [content, setContent] = useState("")
  const [sending, setSending] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [uploadingIdx, setUploadingIdx] = useState<Set<number>>(new Set())
  const [previews, setPreviews] = useState<Map<number, string>>(new Map())
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const [mentionQuery, setMentionQuery] = useState("")
  const [mentionType, setMentionType] = useState<"task" | "user" | null>(null)
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([])
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionStart, setMentionStart] = useState(-1)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 멘션 검색
  useEffect(() => {
    if (!mentionType) {
      setMentionItems([])
      return
    }

    const query = mentionQuery.toLowerCase()

    if (mentionType === "task") {
      const filtered = tasks
        .filter((t) => t.name.toLowerCase().includes(query) || t.slug.toLowerCase().includes(query))
        .slice(0, 5)
        .map((t) => ({ id: t.slug, label: t.name, type: "task" as const }))
      setMentionItems(filtered)
    } else {
      const filteredUsers = users
        .filter((u) => u.name.toLowerCase().includes(query))
        .slice(0, 3)
        .map((u) => ({ id: u.name, label: u.name, type: "user" as const }))

      const filteredFiles = files
        .filter((f) => f.name.toLowerCase().includes(query))
        .slice(0, 3)
        .map((f) => ({ id: f.name, label: f.name, type: "file" as const }))

      setMentionItems([...filteredUsers, ...filteredFiles])
    }
    setMentionIndex(0)
  }, [mentionQuery, mentionType, tasks, users, files])

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value
    setContent(value)

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = value.slice(0, cursorPos)

    // # 또는 @ 감지
    const hashMatch = textBeforeCursor.match(/#([^\s#@]*)$/)
    const atMatch = textBeforeCursor.match(/@([^\s#@]*)$/)

    if (hashMatch) {
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

  function insertMention(item: MentionItem) {
    const prefix = item.type === "task" ? "#" : "@"
    const mentionText = `${prefix}${item.id} `
    const before = content.slice(0, mentionStart)
    const after = content.slice(
      mentionStart + (item.type === "task" ? "#" : "@").length + mentionQuery.length
    )
    setContent(before + mentionText + after)
    setMentionType(null)
    setMentionQuery("")
    setMentionStart(-1)
    textareaRef.current?.focus()
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
        setMentionType(null)
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
      {/* 멘션 팝오버 */}
      {mentionType && mentionItems.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-4 right-4 mb-1 rounded-md border bg-popover p-1 shadow-md"
        >
          {mentionType === "task" && (
            <div className="text-[10px] text-muted-foreground px-2 py-1">업무 선택</div>
          )}
          {mentionType === "user" && (() => {
            const userItems = mentionItems.filter((item) => item.type === "user")
            const fileItems = mentionItems.filter((item) => item.type === "file")
            const allItems = mentionItems
            return (
              <>
                {userItems.length > 0 && (
                  <>
                    <div className="text-[10px] text-muted-foreground px-2 py-1">사람</div>
                    {userItems.map((item) => {
                      const i = allItems.indexOf(item)
                      return (
                        <button
                          key={`user-${item.id}`}
                          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left ${
                            i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            insertMention(item)
                          }}
                        >
                          <span className="text-xs text-muted-foreground">@</span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      )
                    })}
                  </>
                )}
                {fileItems.length > 0 && (
                  <>
                    <div className="text-[10px] text-muted-foreground px-2 py-1 mt-0.5">파일</div>
                    {fileItems.map((item) => {
                      const i = allItems.indexOf(item)
                      return (
                        <button
                          key={`file-${item.id}`}
                          className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left ${
                            i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                          }`}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            insertMention(item)
                          }}
                        >
                          <HugeiconsIcon icon={Attachment01Icon} size={12} className="text-muted-foreground shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      )
                    })}
                  </>
                )}
              </>
            )
          })()}
          {mentionType === "task" && mentionItems.map((item, i) => (
            <button
              key={item.id}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-left ${
                i === mentionIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                insertMention(item)
              }}
            >
              <span className="text-xs text-muted-foreground">#</span>
              <span className="truncate">{item.label}</span>
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
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
        >
          <HugeiconsIcon icon={Attachment01Icon} size={18} />
        </Button>
        <div className="flex-1">
          <Textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="메시지 입력... (#업무 @사람/파일 멘션 가능)"
            className="min-h-[44px] max-h-[120px] resize-none text-sm"
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
