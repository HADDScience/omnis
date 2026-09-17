"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { MessageList } from "@/components/chat/message-list"
import { MessageInput } from "@/components/chat/message-input"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"
import { apiUrl } from "@/lib/base-path"
import { useVisibleInterval } from "@/hooks/use-visible-interval"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
  /** 고친 시각 · 지운 시각 · 답장 대상 (2026-09-16) */
  editedAt?: string | null
  deletedAt?: string | null
  replyTo?: { id: string; authorName: string; content: string } | null
  files?: { id: string; name: string; path: string; size: number; mimeType: string }[]
  _settled?: boolean
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
  // status 는 # 자동완성이 진행 중 · 완료를 나눠 보여 주는 데 쓴다 (/api/tasks 가 이미 준다)
  const [tasks, setTasks] = useState<{ id: string; name: string; slug: string; status?: string }[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<{ id: string; name: string; path: string; mimeType: string }[]>([])
  const [processing, setProcessing] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map()) // msgId → 0~100
  // 답장 대상 — 입력창 위에 한 줄로 물고 있다가 보낼 때 함께 넘긴다
  const [replyTo, setReplyTo] = useState<{ id: string; authorName: string; content: string } | null>(null)
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

      const res = await fetch(apiUrl(`/api/chat/messages?${params.toString()}`))
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
      const res = await fetch(apiUrl(`/api/chat/messages?${params.toString()}`))
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

  // 안 보이는 탭은 멈추고, 돌아오면 바로 한 번 읽는다 — 켜 둔 탭의 폴링이 요청 한도를 채웠다(2026-09-15)
  useVisibleInterval(fetchMessages, 3000)

  useEffect(() => {
    lastFetchedAt.current = ""
    setMessages([])
    setHasMoreOlder(true)
    fetchMessages()
  }, [filterTaskId, fetchMessages])

  useEffect(() => {
    fetch(apiUrl("/api/users"))
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {})
    fetchTasks()
    fetch(apiUrl("/api/files"))
      .then((r) => r.json())
      .then(setUploadedFiles)
      .catch(() => {})
  }, [])

  function fetchTasks() {
    fetch(apiUrl("/api/tasks"))
      .then((r) => r.json())
      .then((data: { id: string; name: string; slug: string; status?: string }[]) => setTasks(data))
      .catch(() => {})
  }

  // AI 재구성은 응답 뒤에 돈다(2026-09-15). 끝날 때까지 「분석하고 있습니다」 를 두고,
  // 끝나면 메시지 · 업무 목록을 다시 읽는다. 90초가 지나면 거둔다 — 결과는 폴링으로 들어온다.
  const waitForRebuild = useCallback(
    async (taskId: string, messageId: string) => {
      const startedAt = Date.now()
      while (Date.now() - startedAt < 90_000) {
        await new Promise((r) => setTimeout(r, 2000))
        const res = await fetch(apiUrl(`/api/tasks/${taskId}/rebuild-status?messageId=${messageId}`)).catch(() => null)
        const data = res?.ok ? ((await res.json().catch(() => null)) as { done?: boolean } | null) : null
        if (data?.done) break
      }
      setProcessing(null)
      fetchMessages()
      fetchTasks()
      onTaskUpdated?.()
    },
    [fetchMessages, onTaskUpdated],
  )

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
          const fRes = await fetch(apiUrl("/api/files"), { method: "POST", body: form })
          if (!fRes.ok) {
            // 예전에는 실패한 파일을 건너뛰고 글만 보냈다 — 첨부가 빠진 줄 모른 채 "보냈다"가 됐다(2026-09-17).
            // 글을 보내지 않고 멈춘다. 던지면 MessageInput 이 쓴 글과 첨부를 남겨 둔다(스레드 입력창과 같은 약속).
            const err = await fRes.json().catch(() => ({}))
            setMessages((prev) => prev.filter((m) => m.id !== tempId))
            setUploadProgress(new Map())
            pausePolling.current = false
            const message = err?.error ?? `「${files[i].name}」 을 올리지 못했습니다`
            toast.error(message)
            throw new Error(message)
          }
          const uploaded = await fRes.json()
          uploadedFiles.push(uploaded)
          setUploadProgress((prev) => new Map(prev).set(`${tempId}-${i}`, 100))
        }
      }

      // 처리 중 상태 표시
      if (hasAction) setProcessing(mentionSlug)

      const res = await fetch(apiUrl("/api/chat/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId,
          content,
          taskId: filterTaskId ?? undefined,
          fileIds: uploadedFiles.map((f) => f.id),
          fileNames: uploadedFiles.map((f) => f.name),
          replyToId: replyTo?.id,
        }),
      })
      setReplyTo(null)

      let queued = false
      if (res.ok) {
        const newMsg = await res.json()
        // 보내는 중 말풍선을 그 자리에서 확정한다 — 다시 떠오르지 않게 표시
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...newMsg, _settled: true } : m)))

        if (newMsg._taskUpdate) {
          fetchMessages()
          fetchTasks()
          onTaskUpdated?.()
        }
        if (newMsg._rebuild === "queued" && newMsg.task?.id) {
          queued = true
          setProcessing(newMsg.task.slug)
          void waitForRebuild(newMsg.task.id, newMsg.id)
        }
      }

      setUploadProgress(new Map())
      if (!queued) setProcessing(null)
      pausePolling.current = false
    },
    [roomId, filterTaskId, fetchMessages, onSlashTaskCommand, onTaskUpdated, waitForRebuild, replyTo]
  )

  /**
   * 내 글 고치기 · 지우기.
   *
   * 업무에 붙은 글이면 서버가 응답 뒤에 재구성을 다시 돌린다(`_rebuild`) —
   * 보낼 때와 같은 자리에서 「분석하고 있습니다」 를 띄우고 끝을 기다린다.
   */
  const applyMessageChange = useCallback(
    async (res: Response, messageId: string) => {
      if (!res.ok) return
      const data = await res.json().catch(() => null)
      // 폴링은 `after` 뒤에 새로 생긴 글만 가져온다 — 고치거나 지운 옛 글은 여기서 그 자리에 갈아 끼운다.
      // fetchMessages() 를 불러도 그 글은 오지 않는다(createdAt 이 과거다).
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m
          if (data?.deleted) {
            return { ...m, content: CHAT_DELETED_TEXT, deletedAt: new Date().toISOString(), files: [], _settled: true }
          }
          return data ? { ...m, ...data, _settled: true } : m
        }),
      )
      const taskId = data?.task?.id ?? messages.find((m) => m.id === messageId)?.task?.id
      if (data?._rebuild === "queued" && taskId) {
        const slug = data?.task?.slug ?? messages.find((m) => m.id === messageId)?.task?.slug ?? null
        if (slug) setProcessing(slug)
        void waitForRebuild(taskId, messageId)
      }
    },
    [messages, waitForRebuild],
  )

  const handleEdit = useCallback(
    async (id: string, content: string) => {
      const res = await fetch(apiUrl(`/api/chat/messages/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      })
      await applyMessageChange(res, id)
    },
    [applyMessageChange],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      const res = await fetch(apiUrl(`/api/chat/messages/${id}`), { method: "DELETE" })
      await applyMessageChange(res, id)
    },
    [applyMessageChange],
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
        onReply={setReplyTo}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <div className="shrink-0 border-t">
        {/* 무엇에 답하는 중인지 입력창 바로 위에 둔다 — 보내고 나면 사라진다 */}
        {replyTo && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            <span className="shrink-0 font-medium">{replyTo.authorName}에게 답장</span>
            <span className="min-w-0 flex-1 truncate">{replyTo.content}</span>
            <button
              type="button"
              aria-label="답장 취소"
              onClick={() => setReplyTo(null)}
              className="shrink-0 rounded px-1 hover:bg-muted"
            >
              ✕
            </button>
          </div>
        )}
        <MessageInput onSend={handleSend} tasks={tasks} files={uploadedFiles} users={users} />
      </div>

    </div>
  )
}
