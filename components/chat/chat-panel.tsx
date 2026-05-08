"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { MessageList } from "@/components/chat/message-list"
import { MessageInput } from "@/components/chat/message-input"
import { TaskInstructionDialog } from "@/components/chat/task-instruction-dialog"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { HugeiconsIcon } from "@hugeicons/react"
import { Task01Icon, CheckmarkCircle02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
}

interface User {
  id: string
  name: string
}

interface ChatPanelProps {
  roomId: string
  initialMessages: Message[]
  currentUserId: string
  onTaskUpdated?: () => void
  onSlashTaskCommand?: (raw: string) => void
  /** ?taskId= URL 필터 — 해당 업무 관련 메시지만 노출 */
  filterTaskId?: string | null
}

export function ChatPanel({
  roomId,
  initialMessages,
  currentUserId,
  onTaskUpdated,
  onSlashTaskCommand,
  filterTaskId,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [users, setUsers] = useState<User[]>([])
  const [tasks, setTasks] = useState<{ id: string; name: string; slug: string }[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; path: string; mimeType: string }[]>([])
  const [processing, setProcessing] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map()) // msgId → 0~100
  const pausePolling = useRef(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [ownerId, setOwnerId] = useState("")
  const [showDialog, setShowDialog] = useState(false)

  const lastFetchedAt = useRef(
    initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].createdAt : ""
  )

  const fetchMessages = useCallback(async () => {
    if (pausePolling.current) return
    try {
      const url = lastFetchedAt.current
        ? `/api/chat/messages?roomId=${roomId}&after=${encodeURIComponent(lastFetchedAt.current)}`
        : `/api/chat/messages?roomId=${roomId}`

      const res = await fetch(url)
      if (!res.ok) return
      const newMsgs = await res.json()

      if (!lastFetchedAt.current) {
        // 초기 로드: 전체 교체
        setMessages(newMsgs)
        if (newMsgs.length > 0) {
          lastFetchedAt.current = newMsgs[newMsgs.length - 1].createdAt
        }
      } else if (newMsgs.length > 0) {
        // 이후: 새 메시지만 추가
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id))
          const unique = newMsgs.filter((m: { id: string }) => !existingIds.has(m.id))
          return unique.length > 0 ? [...prev, ...unique] : prev
        })
        lastFetchedAt.current = newMsgs[newMsgs.length - 1].createdAt
      }
    } catch {
      /* ignore */
    }
  }, [roomId])

  useEffect(() => {
    const id = setInterval(fetchMessages, 3000)
    return () => clearInterval(id)
  }, [fetchMessages])

  useEffect(() => {
    fetch("/api/users")
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {})
    fetchTasks()
    fetch("/api/files")
      .then((r) => r.json())
      .then(setUploadedFiles)
      .catch(() => {})
  }, [])

  function fetchTasks() {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((data: { id: string; name: string; slug: string }[]) => setTasks(data))
      .catch(() => {})
  }

  const handleSend = useCallback(
    async (content: string, files?: File[]) => {
      // /업무 슬래시 커맨드 감지 → 전송 가로채고 TaskCmdModal로 라우팅
      if (content.trim().startsWith("/업무") && onSlashTaskCommand) {
        onSlashTaskCommand(content.trim())
        return
      }
      pausePolling.current = true

      const mentionMatch = content.match(/#([a-z0-9가-힣-]+)/i)
      const mentionSlug = mentionMatch?.[1] || null
      const hasAction = mentionSlug && content.length > (mentionMatch?.[0]?.length || 0) + 2

      // 임시 메시지 즉시 표시 (파일은 아직 업로드 전)
      const tempId = `temp-${Date.now()}`
      const tempFiles = (files || []).map((f, i) => ({
        id: `uploading-${i}`,
        name: f.name,
        path: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
        size: f.size,
        mimeType: f.type,
        _uploading: true,
      }))
      const tempMsg = {
        id: tempId,
        content,
        createdAt: new Date().toISOString(),
        isTaskInstruction: false,
        author: { id: "me", name: "" },
        task: null,
        files: tempFiles,
      }
      setMessages((prev) => [...prev, tempMsg])

      // 파일 업로드 (진행률 업데이트)
      const uploadedFiles: { id: string; name: string; mimeType: string; size: number; path: string }[] = []
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          setUploadProgress((prev) => new Map(prev).set(`${tempId}-${i}`, 30))
          const form = new FormData()
          form.append("file", files[i])
          const fRes = await fetch("/api/files", { method: "POST", body: form })
          if (fRes.ok) {
            const uploaded = await fRes.json()
            uploadedFiles.push(uploaded)
            setUploadProgress((prev) => new Map(prev).set(`${tempId}-${i}`, 100))
          }
        }
      }

      // 처리 중 상태 표시
      if (hasAction) setProcessing(mentionSlug)

      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          content,
          fileIds: uploadedFiles.map((f) => f.id),
          fileNames: uploadedFiles.map((f) => f.name),
        }),
      })

      if (res.ok) {
        const newMsg = await res.json()
        setMessages((prev) => prev.map((m) => (m.id === tempId ? newMsg : m)))

        if (newMsg._taskUpdate) {
          fetchMessages()
          fetchTasks()
          onTaskUpdated?.()
        }
      }

      setUploadProgress(new Map())
      setProcessing(null)
      pausePolling.current = false
    },
    [roomId]
  )

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function cancelSelection() {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setOwnerId("")
  }

  function handleComplete() {
    if (selectedIds.size === 0 || !ownerId) return
    setShowDialog(true)
  }

  const selectedMessages = messages
    .filter((m) => selectedIds.has(m.id))
    .map((m) => ({
      author: m.author.name,
      content: m.content,
      createdAt: m.createdAt,
    }))

  const ownerName = users.find((u) => u.id === ownerId)?.name ?? ""

  const visibleMessages = filterTaskId
    ? messages.filter((m) => m.task?.id === filterTaskId)
    : messages

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MessageList
        messages={visibleMessages}
        currentUserId={currentUserId}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        tasks={tasks}
        processingSlug={processing}
      />

      <div className="shrink-0 border-t">
        {selectionMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-muted/50">
            <span className="text-xs text-muted-foreground shrink-0">
              {selectedIds.size}개 선택
            </span>
            <Select value={ownerId} onValueChange={(v) => setOwnerId(v ?? "")}>
              <SelectTrigger className="h-8 w-32 text-xs">
                <SelectValue placeholder="담당자">
                  {ownerId ? (users.find((u) => u.id === ownerId)?.name ?? null) : null}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id} label={u.name}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={cancelSelection}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
              취소
            </Button>
            <Button
              size="sm"
              className="gap-1 text-xs"
              disabled={selectedIds.size === 0 || !ownerId}
              onClick={handleComplete}
            >
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />
              완료
            </Button>
          </div>
        )}

        <div className="flex items-center gap-2 px-4 pt-2">
          {!selectionMode && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectionMode(true)}
              className="gap-1.5 text-xs shrink-0"
            >
              <HugeiconsIcon icon={Task01Icon} size={14} />
              업무 지시
            </Button>
          )}
        </div>
        <MessageInput onSend={handleSend} disabled={selectionMode} tasks={tasks} users={users} files={uploadedFiles} />
      </div>

      <TaskInstructionDialog
        open={showDialog}
        onOpenChange={(open) => {
          setShowDialog(open)
          if (!open) cancelSelection()
        }}
        selectedMessages={selectedMessages}
        ownerId={ownerId}
        ownerName={ownerName}
        onTaskCreated={() => { fetchMessages(); fetchTasks(); }}
        messageIds={Array.from(selectedIds)}
      />
    </div>
  )
}
