"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { MessageList } from "@/components/chat/message-list"
import { MessageInput } from "@/components/chat/message-input"
import { CHAT_DELETED_TEXT, CHAT_PAGE_SIZE } from "@/lib/constants"
import { apiUrl } from "@/lib/base-path"
import { useVisibleInterval } from "@/hooks/use-visible-interval"
import { reportIncident } from "@/lib/report-client-error"
import { ChatSearch } from "@/components/chat/chat-search"
import { recentForCache, roomCacheKey, writeCache } from "@/lib/chat-cache"
import { applyChanges, encodeCursor, laterOf, mergeIncoming } from "@/lib/chat-cursor"

interface Message {
  id: string
  content: string
  createdAt: string
  isTaskInstruction: boolean
  author: { id: string; name: string }
  task?: { id: string; name: string; slug: string } | null
  /** 고친 시각 · 지운 시각 · 답장 대상 (2026-09-16) */
  editedAt?: string | null
  /** 화면에 보이는 것이 바뀐 시각 — 폴링이 같은 변경을 두 번 끼우지 않게 비교한다(2026-10-30) */
  changedAt?: string | null
  deletedAt?: string | null
  replyTo?: { id: string; authorName: string; content: string } | null
  files?: { id: string; name: string; path: string; size: number; mimeType: string }[]
  _settled?: boolean
  /** 서버가 돌려준 화면 id — 응답이 끊긴 말풍선과 폴링으로 들어온 진짜 글을 잇는다 */
  clientId?: string | null
  /** 보내는 중 말풍선의 화면 id */
  _clientId?: string
  /** 보내지 못한 말풍선 — 까닭. 다시 보내기 · 지우기를 띄운다 */
  _failed?: string
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
  /** 검색창 — 여는 버튼은 패널 머리(right-panel)에 있다 */
  searchOpen?: boolean
  onSearchOpenChange?: (open: boolean) => void
  /** 단축키(⌘⇧F)를 누를 때마다 오른다 — 검색칸을 다시 고른다 */
  searchFocus?: number
  /**
   * 사람끼리 방(1:1 · 단톡) — @ 후보는 그 방 참여자만, `/` 명령 · # 업무 · 첨부는 끈다.
   * 이 방 글은 업무에 붙지 않고(서버가 업무 연결을 하지 않는다) 파일 목록은 방을 가리지 않아서다
   */
  people?: { members: User[] }
  /** 메신저 방 키 — loading 입력창에 쓴 글을 이어받는다(lib/chat-entry.ts). 오른쪽 패널은 비운다 */
  handoffKey?: string
}

// 사람끼리 방은 업무 · 파일 후보가 없다. MessageInput 의 기본값([])은 그릴 때마다 새 배열이라
// 후보 계산 effect 가 setState 를 되풀이해 무한 갱신이 났다(대화상자를 열면 터졌다) — 같은 배열을 넘긴다
const NO_TASKS: { id: string; name: string; slug: string; status?: string }[] = []
const NO_FILES: { id: string; name: string; path: string; mimeType: string }[] = []

/** 커서로 쓰는 두 칸 — 시각만 들고 있으면 같은 시각의 글이 빠진다(lib/chat-cursor.ts) */
type CursorEdge = { createdAt: string; id: string }
const edgeOf = (m: { createdAt: string; id: string }): CursorEdge => ({ createdAt: m.createdAt, id: m.id })
/** 아직 서버 id 가 없는 보내는 중 말풍선 */
const isLocal = (m: { id: string }) => m.id.startsWith("temp-")

/** 다시 보내기에 쓰는 요청 본문 — 같은 clientId 로 보내야 서버가 두 번 저장하지 않는다 */
type SendPayload = {
  roomId: string
  content: string
  taskId?: string
  fileIds: string[]
  fileNames: string[]
  replyToId?: string
  clientId: string
}

/** 첨부 단계에서 멈췄다는 표시 — 이 오류는 MessageInput 까지 그대로 던진다(쓴 글 · 첨부를 남긴다) */
class SendStopped extends Error {}

/**
 * 폴링으로 진짜 글이 들어왔으면 그 글의 보내는 중 · 실패 말풍선을 걷는다.
 * 응답만 끊긴 글은 서버에 저장돼 있어서, 이것이 없으면 실패 말풍선과 진짜 글이 둘 다 보인다
 */
function dropEchoed(list: Message[]): Message[] {
  const echoed = new Set(list.flatMap((m) => (!isLocal(m) && m.clientId ? [m.clientId] : [])))
  if (echoed.size === 0) return list
  const next = list.filter((m) => !(isLocal(m) && m._clientId && echoed.has(m._clientId)))
  return next.length === list.length ? list : next
}

export function ChatPanel({
  roomId,
  initialMessages,
  currentUserId,
  onTaskUpdated,
  onSlashTaskCommand,
  filterTaskId,
  searchOpen = false,
  onSearchOpenChange,
  searchFocus = 0,
  people,
  handoffKey,
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
  // 검색 결과 보기 — 최신이 아닌 자리를 보고 있다. 폴링을 멈추고, 아래로 스크롤하면 뒤를 이어 붙인다
  const [jumped, setJumped] = useState(false)
  const jumpedRef = useRef(false)
  const [hasMoreNewer, setHasMoreNewer] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [highlight, setHighlight] = useState<{ id: string; n: number } | null>(null)

  // 기기에 저장 — 다음에 이 방을 열 때 서버를 기다리지 않고 바로 그린다(lib/chat-cache.ts). 최근 30개 · 본문만.
  // 업무로 거른 목록 · 검색 점프 중의 목록은 「이 방의 최근 글」 이 아니라 저장하지 않는다
  useEffect(() => {
    if (filterTaskId || jumped || messages.length === 0) return
    void writeCache(
      currentUserId,
      roomCacheKey(`room:${roomId}`),
      recentForCache(messages.filter((m) => !m.deletedAt)).map((m) => ({
        id: m.id,
        author: m.author,
        mine: m.author.id === currentUserId,
        content: m.content.startsWith("__TASK_CREATED__") ? "업무가 생성되었습니다" : m.content,
        createdAt: m.createdAt,
      })),
    )
  }, [messages, roomId, currentUserId, filterTaskId, jumped])

  // 마지막으로 받은 글. 비어 있으면 다음 읽기가 최신 한 페이지로 갈아 끼운다
  const lastFetchedAt = useRef<CursorEdge | null>(
    initialMessages.length > 0 ? edgeOf(initialMessages[initialMessages.length - 1]) : null
  )

  // 남이 고치거나 지운 글을 마지막으로 물어본 서버 시각 — 화면 시계가 아니라 서버가 돌려준 값을 쓴다
  const changesCheckedAt = useRef<string | null>(null)

  const fetchMessages = useCallback(async () => {
    if (pausePolling.current || jumpedRef.current) return
    try {
      const params = new URLSearchParams({ roomId })
      if (lastFetchedAt.current) {
        params.set("after", encodeCursor(lastFetchedAt.current))
        params.set("changes", "1")
        if (changesCheckedAt.current) params.set("changesSince", changesCheckedAt.current)
      }
      if (filterTaskId) params.set("taskId", filterTaskId)

      const res = await fetch(apiUrl(`/api/chat/messages?${params.toString()}`))
      if (!res.ok) return
      const body = await res.json()
      // 폴링(changes=1)은 { messages, changed, checkedAt }, 첫 읽기는 배열
      const newMsgs: Message[] = Array.isArray(body) ? body : body.messages
      if (!Array.isArray(body)) {
        changesCheckedAt.current = body.checkedAt
        if (body.changed.length > 0) setMessages((prev) => applyChanges(prev, body.changed as Message[]))
      }

      if (!lastFetchedAt.current) {
        // 초기 로드: 최신 페이지로 교체
        setMessages(newMsgs)
        if (newMsgs.length > 0) {
          lastFetchedAt.current = edgeOf(newMsgs[newMsgs.length - 1])
        }
        setHasMoreOlder(newMsgs.length >= CHAT_PAGE_SIZE)
      } else if (newMsgs.length > 0) {
        // 이후: 새 메시지만 추가. 서버는 커서보다 조금 앞부터 겹쳐 준다 — 늦게 커밋된 글은 제자리에 끼운다
        setMessages((prev) => dropEchoed(mergeIncoming(prev, newMsgs, isLocal)))
        lastFetchedAt.current = laterOf(lastFetchedAt.current, edgeOf(newMsgs[newMsgs.length - 1]))
      }
    } catch {
      /* ignore */
    }
  }, [roomId, filterTaskId])

  // 무한 스크롤 — 현재 가장 오래된 메시지보다 이전 메시지 한 페이지를 앞에 붙임
  const loadOlder = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder) return
    const oldest = messages.find((m) => !isLocal(m))
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const params = new URLSearchParams({ roomId, before: encodeCursor(oldest) })
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

  const endJump = useCallback(() => {
    jumpedRef.current = false
    setJumped(false)
    setHasMoreNewer(false)
  }, [])

  useEffect(() => {
    endJump()
    lastFetchedAt.current = null
    setMessages([])
    setHasMoreOlder(true)
    fetchMessages()
  }, [filterTaskId, fetchMessages, endJump])

  /** 「최신으로」 — 검색 결과 보기를 끝내고 최신 한 페이지부터 다시 */
  const backToLatest = useCallback(() => {
    endJump()
    setHighlight(null)
    lastFetchedAt.current = null
    setMessages([])
    setHasMoreOlder(true)
    fetchMessages()
  }, [endJump, fetchMessages])

  /** 검색 결과로 간다 — 그 글 앞뒤만 불러와 목록을 갈아 끼운다(방 전체는 1만 건이 넘는다) */
  // 이미 불러온 자리 안이면 다시 받지 않는다 — ▲▼ 로 이웃한 결과를 넘길 때 목록이 출렁이지 않게
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  /** 주변 불러오기(around=id 또는 at=시각)로 목록을 갈아 끼우고 대상을 강조한다 */
  const loadAround = useCallback(
    async (query: { around: string } | { at: string }) => {
      const params = new URLSearchParams({ roomId, ...query })
      if (filterTaskId) params.set("taskId", filterTaskId)
      const res = await fetch(apiUrl(`/api/chat/messages?${params.toString()}`)).catch(() => null)
      if (!res?.ok) {
        toast.error("그 메시지를 불러오지 못했습니다")
        return
      }
      const data: { targetId: string; messages: Message[]; hasMoreOlder: boolean; hasMoreNewer: boolean } =
        await res.json()
      // 뒤가 더 없으면 최신까지 다 받은 것이다 — 평소 목록과 같으니 폴링을 그대로 둔다
      jumpedRef.current = data.hasMoreNewer
      setJumped(data.hasMoreNewer)
      setHasMoreNewer(data.hasMoreNewer)
      setHasMoreOlder(data.hasMoreOlder)
      setMessages(data.messages)
      if (data.messages.length > 0) lastFetchedAt.current = edgeOf(data.messages[data.messages.length - 1])
      setHighlight((prev) => ({ id: data.targetId, n: (prev?.n ?? 0) + 1 }))
    },
    [roomId, filterTaskId],
  )

  const jumpTo = useCallback(
    async (messageId: string) => {
      if (messagesRef.current.some((m) => m.id === messageId)) {
        setHighlight((prev) => ({ id: messageId, n: (prev?.n ?? 0) + 1 }))
        return
      }
      await loadAround({ around: messageId })
    },
    [loadAround],
  )

  // 검색 줄을 닫으면 최신 목록으로 돌아간다. 옛 자리에 머물면 새 글이 안 들어온다(폴링이 멈춰 있다)
  const [searchText, setSearchText] = useState("")
  const wasSearchOpen = useRef(searchOpen)
  useEffect(() => {
    if (wasSearchOpen.current && !searchOpen) {
      setSearchText("")
      setHighlight(null)
      if (jumpedRef.current) backToLatest()
    }
    wasSearchOpen.current = searchOpen
  }, [searchOpen, backToLatest])

  // 검색 결과 보기에서 아래로 — 한 페이지씩 붙이고, 다 따라잡으면 평소 목록(폴링)으로 돌아간다
  const loadNewer = useCallback(async () => {
    if (loadingNewer || !hasMoreNewer || !lastFetchedAt.current) return
    setLoadingNewer(true)
    try {
      const params = new URLSearchParams({ roomId, after: encodeCursor(lastFetchedAt.current), take: String(CHAT_PAGE_SIZE) })
      if (filterTaskId) params.set("taskId", filterTaskId)
      const res = await fetch(apiUrl(`/api/chat/messages?${params.toString()}`))
      if (!res.ok) return
      const newer: Message[] = await res.json()
      if (newer.length > 0) {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id))
          const fresh = newer.filter((m) => !ids.has(m.id))
          return fresh.length > 0 ? [...prev, ...fresh] : prev
        })
        lastFetchedAt.current = edgeOf(newer[newer.length - 1])
      }
      if (newer.length < CHAT_PAGE_SIZE) endJump()
    } catch {
      /* ignore */
    } finally {
      setLoadingNewer(false)
    }
  }, [loadingNewer, hasMoreNewer, roomId, filterTaskId, endJump])

  const peopleMembers = people?.members
  useEffect(() => {
    if (peopleMembers) {
      setUsers(peopleMembers)
      return
    }
    fetch(apiUrl("/api/users"))
      .then((r) => r.json())
      .then(setUsers)
      .catch(() => {})
    fetchTasks()
    fetch(apiUrl("/api/files"))
      .then((r) => r.json())
      .then(setUploadedFiles)
      .catch(() => {})
  }, [peopleMembers])

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

  /** 첨부가 막혀 보내기를 멈춘다 — 임시 말풍선을 거두고 알린 뒤 던진다. 던지면 MessageInput 이 글과 첨부를 남긴다 */
  const stopSending = useCallback((tempId: string, message: string): never => {
    setMessages((prev) => prev.filter((m) => m.id !== tempId))
    toast.error(message)
    throw new SendStopped(message)
  }, [])

  // 보내지 못한 글의 요청 본문 — 다시 보내기가 같은 clientId 로 보낸다
  const failedPayloads = useRef(new Map<string, SendPayload>())

  /**
   * 글을 서버에 보내고 말풍선을 확정한다. 실패하면 말풍선을 「보내지 못함」 으로 바꾼다 — 예전에는 「보내는 중」 으로 영원히 남았다.
   * `fromInput` 이면 사람 방의 첨부 거절은 말풍선을 걷고 던진다(입력창이 쓴 글 · 첨부를 되돌려 놓는다)
   */
  const deliver = useCallback(
    async (tempId: string, payload: SendPayload, fromInput: boolean) => {
      const fail = (reason: string) => {
        failedPayloads.current.set(tempId, payload)
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _failed: reason } : m)))
        setProcessing(null)
      }
      const res = await fetch(apiUrl("/api/chat/messages"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => null)
      if (!res) {
        // 서버에 닿았는지 모른다 — 다시 보내도 clientId 가 같아 두 번 저장되지 않는다
        reportIncident({ kind: "send_failed", message: "네트워크 오류로 메시지 전송 실패" })
        fail("연결이 끊겨 보내지 못했습니다")
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        reportIncident({ kind: "send_failed", message: err?.error ?? "메시지 전송 실패", status: res.status })
        // 사람 방은 첨부를 서버가 거절할 수 있다(남의 파일 · 이미 붙은 파일) — 말풍선을 걷고 쓴 글 · 첨부를 남긴다
        if (people && fromInput && res.status < 500) stopSending(tempId, err?.error ?? "보내지 못했습니다")
        fail(err?.error ?? "보내지 못했습니다")
        return
      }
      failedPayloads.current.delete(tempId)
      const newMsg = await res.json()
      // 보내는 중 말풍선을 그 자리에서 확정한다 — 다시 떠오르지 않게 표시. 폴링이 먼저 들여왔으면 말풍선만 걷는다
      setMessages((prev) =>
        prev.some((m) => m.id === newMsg.id)
          ? prev.filter((m) => m.id !== tempId)
          : prev.map((m) => (m.id === tempId ? { ...newMsg, _settled: true } : m)),
      )

      if (newMsg._taskUpdate) {
        fetchMessages()
        fetchTasks()
        onTaskUpdated?.()
      }
      if (newMsg._rebuild === "queued" && newMsg.task?.id) {
        setProcessing(newMsg.task.slug)
        void waitForRebuild(newMsg.task.id, newMsg.id)
      } else {
        setProcessing(null)
      }
    },
    [people, stopSending, fetchMessages, onTaskUpdated, waitForRebuild],
  )

  /** 보내지 못한 글을 같은 clientId 로 다시 보낸다 */
  const resend = useCallback(
    async (tempId: string) => {
      const payload = failedPayloads.current.get(tempId)
      if (!payload) return
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, _failed: undefined } : m)))
      pausePolling.current = true
      try {
        await deliver(tempId, payload, false)
      } finally {
        pausePolling.current = false
      }
    },
    [deliver],
  )

  /** 보내지 못한 글을 거둔다 — 서버에 닿았던 글이면 폴링이 진짜 글로 다시 들여온다 */
  const discardFailed = useCallback((tempId: string) => {
    failedPayloads.current.delete(tempId)
    setMessages((prev) => prev.filter((m) => m.id !== tempId))
  }, [])

  const handleSend = useCallback(
    async (content: string, files?: File[], nasPaths?: string[]) => {
      // /업무 슬래시 커맨드 감지 → 전송 가로채고 TaskCmdModal로 라우팅
      if (content.trim().startsWith("/업무") && onSlashTaskCommand) {
        onSlashTaskCommand(content.trim())
        return
      }
      // 옛 자리를 보다가 보내면 새 글이 엉뚱한 자리에 붙는다 — 최신 목록으로 돌아가서 보낸다.
      // 폴링은 보내는 동안 멈춰 있다가, 끝나면 lastFetchedAt 이 비어 있어 최신 한 페이지로 갈아 끼운다
      if (jumpedRef.current) {
        endJump()
        setHighlight(null)
        lastFetchedAt.current = null
        setMessages([])
        setHasMoreOlder(true)
      }
      pausePolling.current = true
      // 어떤 길로 끝나든(첨부 실패 · 네트워크 오류 포함) 폴링을 다시 켠다 — 예전에는 fetch 가 던지면 그 방 폴링이 멈춘 채 남았다
      try {
        const mentionMatch = content.match(/#([a-z0-9가-힣-]+)/i)
        const mentionSlug = mentionMatch?.[1] || null
        const hasAction = mentionSlug && content.length > (mentionMatch?.[0]?.length || 0) + 2

        // 임시 메시지 즉시 표시 (파일은 아직 업로드 전)
        const tempId = `temp-${Date.now()}`
        const clientId = crypto.randomUUID()
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
          _clientId: clientId,
        }
        setMessages((prev) => [...prev, tempMsg])

        // 파일 업로드 (진행률 업데이트)
        const uploadedFiles: { id: string; name: string; mimeType: string; size: number; path: string }[] = []
        try {
          if (files && files.length > 0) {
            for (let i = 0; i < files.length; i++) {
              setUploadProgress((prev) => new Map(prev).set(`${tempId}-${i}`, 30))
              const form = new FormData()
              form.append("file", files[i])
              // 사람끼리 방 — 참여자만 보는 파일로 올린다(붙기 전에는 나만, 붙은 뒤에는 그 방 참여자만, lib/file-access.ts)
              if (people) form.append("scope", "private")
              const fRes = await fetch(apiUrl("/api/files"), { method: "POST", body: form })
              if (!fRes.ok) {
                // 예전에는 실패한 파일을 건너뛰고 글만 보냈다 — 첨부가 빠진 줄 모른 채 "보냈다"가 됐다(2026-09-17).
                // 글을 보내지 않고 멈춘다. 던지면 MessageInput 이 쓴 글과 첨부를 남겨 둔다(스레드 입력창과 같은 약속).
                const err = await fRes.json().catch(() => ({}))
                reportIncident({ kind: "upload_failed", message: err?.error ?? "파일 업로드 실패", status: fRes.status, size: files[i].size, fileName: files[i].name })
                stopSending(tempId, err?.error ?? `「${files[i].name}」 을 올리지 못했습니다`)
              }
              const uploaded = await fRes.json()
              uploadedFiles.push(uploaded)
              setUploadProgress((prev) => new Map(prev).set(`${tempId}-${i}`, 100))
            }
          }

          // NAS 에 있는 파일은 올리지 않고 잇는다(2026-09-17)
          for (const path of nasPaths ?? []) {
            const lRes = await fetch(apiUrl("/api/files/nas"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(people ? { path, scope: "private" } : { path }),
            })
            if (!lRes.ok) {
              const err = await lRes.json().catch(() => ({}))
              reportIncident({ kind: "upload_failed", message: err?.error ?? "NAS 파일 연결 실패", status: lRes.status, fileName: path })
              stopSending(tempId, err?.error ?? "시놀로지 파일을 연결하지 못했습니다")
            }
            uploadedFiles.push(await lRes.json())
          }
        } catch (err) {
          if (err instanceof SendStopped) throw err
          // 올리는 중에 연결이 끊겼다 — 글은 보내지 않고 입력창에 남긴다
          reportIncident({ kind: "upload_failed", message: "네트워크 오류로 첨부 실패" })
          stopSending(tempId, "연결이 끊겨 파일을 올리지 못했습니다")
        }

        // 처리 중 상태 표시
        if (hasAction) setProcessing(mentionSlug)

        const payload: SendPayload = {
          roomId,
          content,
          taskId: filterTaskId ?? undefined,
          fileIds: uploadedFiles.map((f) => f.id),
          fileNames: uploadedFiles.map((f) => f.name),
          replyToId: replyTo?.id,
          clientId,
        }
        setReplyTo(null)
        await deliver(tempId, payload, true)
      } finally {
        setUploadProgress(new Map())
        pausePolling.current = false
      }
    },
    [roomId, filterTaskId, onSlashTaskCommand, replyTo, stopSending, endJump, people, deliver]
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
      {searchOpen && (
        <ChatSearch
          roomId={roomId}
          taskId={filterTaskId ?? null}
          users={users}
          focusSignal={searchFocus}
          onClose={() => onSearchOpenChange?.(false)}
          onGo={(id) => void jumpTo(id)}
          onGoDate={(at) => void loadAround({ at })}
          onSearchTextChange={setSearchText}
        />
      )}
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
        onResend={resend}
        onDiscardFailed={discardFailed}
        highlight={highlight}
        jumped={jumped}
        onLoadNewer={loadNewer}
        hasMoreNewer={hasMoreNewer}
        loadingNewer={loadingNewer}
        searchText={searchOpen ? searchText : ""}
      />

      <div className="shrink-0 border-t">
        {/* 무엇에 답하는 중인지 입력창 바로 위에 둔다 — 보내고 나면 사라진다 */}
        {replyTo && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground in-data-[messenger]:px-4 in-data-[messenger]:py-2.5 in-data-[messenger]:text-[14px]">
            <span className="shrink-0 font-medium">{replyTo.authorName}에게 답장</span>
            <span className="min-w-0 flex-1 truncate">{replyTo.content}</span>
            <button
              type="button"
              aria-label="답장 취소"
              onClick={() => setReplyTo(null)}
              className="shrink-0 rounded px-1 in-data-[messenger]:px-2.5 in-data-[messenger]:py-1 hover:bg-muted"
            >
              ✕
            </button>
          </div>
        )}
        {people ? (
          <MessageInput
            onSend={handleSend}
            users={users}
            tasks={NO_TASKS}
            files={NO_FILES}
            commands={false}
            taskMentions={false}
            placeholder="메시지 입력...  @ 사람"
            handoffKey={handoffKey}
          />
        ) : (
          <MessageInput onSend={handleSend} tasks={tasks} files={uploadedFiles} users={users} handoffKey={handoffKey} />
        )}
      </div>

    </div>
  )
}
