"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { MessageList } from "@/components/chat/message-list"
import { MessageInput } from "@/components/chat/message-input"
import { CHAT_PAGE_SIZE } from "@/lib/constants"

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
  const [hasMoreOlder, setHasMoreOlder] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [tasks, setTasks] = useState<{ id: string; name: string; slug: string }[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; path: string; mimeType: string }[]>([])
  const [processing, setProcessing] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map()) // msgId → 0~100
  const pausePolling = useRef(false)

  const lastFetchedAt = useRef(
    initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].createdAt : ""
  )

  const fetchMessages = useCallback(async () => {
    if (pausePolling.current) return
    try {
      const params = new URLSearchParams({ roomId })
      if (lastFetchedAt.current) params.set("after", lastFetchedAt.current)
      if (filterTaskId) params.set("taskId", filterTaskId)

      const res = await fetch(`/api/chat/messages?${params.toString()}`)
      if (!res.ok) return
      const newMsgs = await res.json()

      if (!lastFetchedAt.current) {
        // 초기 로드: 최신 페이지로 교체
        setMessages(newMsgs)
        if (newMsgs.length > 0) {
          lastFetchedAt.current = newMsgs[newMsgs.length - 1].createdAt
        }
        setHasMoreOlder(newMsgs.length >= CHAT_PAGE_SIZE)
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
  }, [roomId, filterTaskId])

  // 무한 스크롤 — 현재 가장 오래된 메시지보다 이전 메시지 한 페이지를 앞에 붙임
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return
    const oldest = messages[0]
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const params = new URLSearchParams({ roomId, before: oldest.createdAt })
      if (filterTaskId) params.set("taskId", filterTaskId)
      const res = await fetch(`/api/chat/messages?${params.toString()}`)
      if (!res.ok) return
      const older: Message[] = await res.json()
      if (older.length < CHAT_PAGE_SIZE) setHasMoreOlder(false)
      if (older.length > 0) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id))
          const fresh = older.filter((m) => !ids.has(m.id))
          return fresh.length > 0 ? [...fresh, ...prev] : prev
        })
      }
    } catch {
      /* ignore */
    } finally {
      setLoadingOlder(false)
    }
  }, [loadingOlder, hasMoreOlder, messages, roomId, filterTaskId])

  useEffect(() => {
    const id = setInterval(fetchMessages, 3000)
    return () => clearInterval(id)
  }, [fetchMessages])

  useEffect(() => {
    lastFetchedAt.current = ""
    setMessages([])
    setHasMoreOlder(true)
    fetchMessages()
  }, [filterTaskId, fetchMessages])

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
          taskId: filterTaskId ?? undefined,
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
    [roomId, filterTaskId, fetchMessages, onSlashTaskCommand, onTaskUpdated]
  )






  const visibleMessages = filterTaskId
    ? messages.filter((m) => m.task?.id === filterTaskId)
    : messages

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MessageList
        messages={visibleMessages}
        currentUserId={currentUserId}
        tasks={tasks}
        processingSlug={processing}
        onLoadOlder={loadOlder}
        hasMoreOlder={hasMoreOlder}
        loadingOlder={loadingOlder}
      />

      <div className="shrink-0 border-t">
        <MessageInput onSend={handleSend} tasks={tasks} files={uploadedFiles} users={users} />
      </div>

    </div>
  )
}
