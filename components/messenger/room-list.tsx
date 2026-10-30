"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BubbleChatSparkIcon,
  Building03Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Cancel01Icon,
  Delete02Icon,
  FolderLibraryIcon,
  Logout03Icon,
  Notification03Icon,
  NotificationOff03Icon,
  PencilEdit02Icon,
  Search01Icon,
  StarIcon,
  Task01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { LinkPendingMark } from "@/components/ui/pending-link"
import { NotificationBell } from "@/components/layout/notification-bell"
import { NAV_DESKTOP_QUERY } from "@/components/layout/floating-nav"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { TASK_STATUS_LABELS } from "@/lib/constants"
import { timeLabel } from "@/lib/chat-layout"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import {
  FIXED_CHIPS,
  folderHasRoom,
  resolveChip,
  roomKeyFromPath,
  roomRemoval,
  roomsInChip,
  sortByRecent,
  groupTaskRooms,
  type TaskGroupStatus,
  unreadLabel,
  unreadRoomCount,
  type ChatFolderView,
  type ChipId,
  type RoomRemoval,
} from "@/lib/chat-list"
import type { RoomList as RoomListData, RoomListItem } from "@/lib/chat-rooms"
import { chatPrefs } from "./chat-prefs-client"
import { LIST_CACHE_KEY, readCache, writeCache } from "@/lib/chat-cache"
import { rememberRoomList } from "@/lib/chat-entry"
import { FolderManager } from "./folder-manager"
import { SwipeRow, type SwipeSide } from "./swipe-row"
import { AuthorAvatar } from "@/components/chat/message-parts"
import { useStartRoomEntry } from "./messenger-context"

/** 전사방 · 업무방은 다른 사람이 글을 쓴다 — 목록을 열어 둔 동안 이 간격으로 다시 읽는다 */
const POLL_MS = 30_000
/** 검색어를 치는 동안 서버에 묻지 않고 기다리는 시간 */
const SEARCH_DEBOUNCE_MS = 250

function roomHref(r: RoomListItem): string {
  return r.kind === "TASK" ? `/chat/task/${r.id}` : `/chat/${r.id}`
}

/** 오늘이면 「오후 2:08」, 올해면 「10월 3일」, 그 전이면 「2025. 10. 3.」 */
function listTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return timeLabel(d)
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`
}

function flatten(d: RoomListData | null): RoomListItem[] {
  return d ? [...d.omnis, ...d.company, ...d.tasks, ...d.groups] : []
}

/** 목록 응답 안의 방 하나를 바꾼다(즐겨찾기 · 읽음을 서버 응답 전에 먼저 그릴 때) */
function patchRoom(d: RoomListData, key: string, patch: Partial<RoomListItem>): RoomListData {
  const up = (rows: RoomListItem[]) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r))
  return {
    ...d,
    omnis: up(d.omnis),
    company: up(d.company),
    tasks: up(d.tasks),
    groups: up(d.groups),
  }
}

const chipStorageKey = (userId: string) => `omnis.chat.chip.${userId}`
const taskGroupsStorageKey = (userId: string) => `omnis.chat.task-groups-open.${userId}`

/**
 * 메신저 왼쪽 목록 — 칩 한 줄(전체 · 옴니스 · 안읽음 · 즐겨찾기 · 내 폴더 · 폴더 관리) · 검색칸 · 방 목록.
 * 검색칸은 목록 맨 위에 붙어 있다. 폰에서는 처음에 그 높이만큼 내려 둬 숨는다 — 끌어내리면 나온다(iOS 연락처).
 * PC 는 화면이 넉넉해 처음부터 보인다(2026-10-29 작업지시자).
 * 칩은 방 종류로 칸을 나누지 않고 최근 글 순 한 목록을 거른다. 검색은 칩과 상관없이 전체에서 찾는다.
 * 지금 연 방은 열 때 · 떠날 때 · 새 글이 보일 때 읽음으로 올린다 — 대화 칸을 건드리지 않고 주소로 안다.
 * `version` 이 오르면 다시 읽는다 — 방 화면이 새 대화를 만들거나 답을 받았을 때 올린다.
 */
export function RoomList({ version, userId }: { version: number; userId: string }) {
  const pathname = usePathname()
  const activeKey = roomKeyFromPath(pathname)
  const [data, setData] = useState<RoomListData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chip, setChip] = useState<ChipId>("all")
  const chipRestored = useRef(false)
  const [query, setQuery] = useState("")
  const [search, setSearch] = useState<{
    q: string
    data: RoomListData | null
    error: string | null
  } | null>(null)
  const [searchTry, setSearchTry] = useState(0)
  const listRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  // 폰의 알림 종 — 채팅 화면에는 제목줄이 없어 칩 줄 끝에 둔다. PC 는 떠 있는 nav 에 있다
  const isMdUp = useMediaQuery(NAV_DESKTOP_QUERY)
  const [manager, setManager] = useState<{
    open: boolean
    pickFolderId?: string
  }>({ open: false })

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/rooms"))
      if (!res.ok) throw new Error(`목록을 불러오지 못했습니다 (${res.status})`)
      const next = (await res.json()) as RoomListData
      setData(next)
      setError(null)
      rememberRoomList(next)
      void writeCache(userId, LIST_CACHE_KEY, next)
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다")
    }
  }, [userId])

  // 기기에 저장해 둔 목록으로 먼저 그린다 — 서버 응답이 오면 갈아 끼운다(lib/chat-cache.ts)
  useEffect(() => {
    void readCache<RoomListData>(userId, LIST_CACHE_KEY).then((cached) => {
      if (cached) setData((d) => d ?? cached)
    })
  }, [userId])

  useEffect(() => {
    void load()
  }, [load, version])

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // 마지막으로 고른 칩 — 폴더 목록이 와야 그 폴더가 아직 있는지 안다
  useEffect(() => {
    if (!data || chipRestored.current) return
    chipRestored.current = true
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(chipStorageKey(userId))
    } catch {
      // 저장소를 못 읽으면 「전체」 로 시작한다
    }
    setChip(resolveChip(saved, data.folders))
  }, [data, userId])

  // 고른 폴더를 지웠으면 「전체」 로
  useEffect(() => {
    if (data && chip.startsWith("folder:") && resolveChip(chip, data.folders) !== chip) setChip("all")
  }, [data, chip])

  const selectChip = useCallback(
    (next: ChipId) => {
      setChip(next)
      try {
        window.localStorage.setItem(chipStorageKey(userId), next)
      } catch {
        // 저장 실패는 이번 세션에만 영향이 있다
      }
    },
    [userId],
  )

  // ─── 읽음 ───
  const markRead = useCallback((key: string) => {
    setData((d) => (d ? patchRoom(d, key, { unread: 0 }) : d))
    chatPrefs.markRead(key).catch(() => {
      // 읽음 표시 실패는 다음 목록 읽기 때 배지로 다시 보인다 — 알릴 만한 일이 아니다
    })
  }, [])

  // 방을 열 때와 떠날 때 — 떠날 때까지 그 방에서 본 글도 읽은 것이다
  useEffect(() => {
    if (!activeKey) return
    markRead(activeKey)
    return () => markRead(activeKey)
  }, [activeKey, markRead])

  // 연 방에 새 글이 와서 목록이 안 읽은 글을 세면 — 지금 보고 있으므로 읽음
  const activeUnread = activeKey ? (flatten(data).find((r) => r.key === activeKey)?.unread ?? 0) : 0
  useEffect(() => {
    if (activeKey && activeUnread > 0) markRead(activeKey)
  }, [activeKey, activeUnread, markRead])

  // ─── 검색 ───
  const trimmed = query.trim()
  useEffect(() => {
    if (!trimmed) {
      setSearch(null)
      return
    }
    const ctl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/chat/rooms?q=${encodeURIComponent(trimmed)}`), { signal: ctl.signal })
        if (!res.ok) throw new Error(`검색하지 못했습니다 (${res.status})`)
        setSearch({
          q: trimmed,
          data: (await res.json()) as RoomListData,
          error: null,
        })
      } catch (err) {
        if (ctl.signal.aborted) return
        setSearch({
          q: trimmed,
          data: null,
          error: err instanceof Error ? err.message : "검색하지 못했습니다",
        })
      }
    }, SEARCH_DEBOUNCE_MS)
    setSearch((s) => (s && s.q === trimmed ? s : { q: trimmed, data: null, error: null }))
    return () => {
      ctl.abort()
      clearTimeout(timer)
    }
  }, [trimmed, version, searchTry])

  // ─── 방 동작 ───
  const folders = useMemo(() => data?.folders ?? [], [data])
  const rooms = useMemo(() => flatten(data), [data])

  const toggleFavorite = useCallback(
    async (room: RoomListItem) => {
      const next = !room.favorite
      setData((d) => (d ? patchRoom(d, room.key, { favorite: next }) : d))
      setSearch((s) => (s?.data ? { ...s, data: patchRoom(s.data, room.key, { favorite: next }) } : s))
      try {
        await chatPrefs.setFavorite(room.key, next)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "즐겨찾기를 바꾸지 못했습니다")
      }
      void load()
    },
    [load],
  )

  const toggleFolder = useCallback(
    async (room: RoomListItem, folder: ChatFolderView) => {
      const inside = folder.roomKeys.includes(room.key)
      setData((d) =>
        d
          ? {
              ...d,
              folders: d.folders.map((f) =>
                f.id === folder.id
                  ? {
                      ...f,
                      roomKeys: inside ? f.roomKeys.filter((k) => k !== room.key) : [...f.roomKeys, room.key],
                    }
                  : f,
              ),
            }
          : d,
      )
      try {
        if (inside) await chatPrefs.removeFromFolder(folder.id, room.key)
        else await chatPrefs.addToFolder(folder.id, room.key)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "폴더를 바꾸지 못했습니다")
      }
      void load()
    },
    [load],
  )

  // ─── 지우기 · 숨기기 · 나가기 ───
  const router = useRouter()

  /** 이 방의 채팅 푸시 끄기 · 켜기. 지금 연 방이면 머리줄도 새 값으로 다시 그린다 */
  const toggleMuted = useCallback(
    async (room: RoomListItem) => {
      const next = !room.muted
      setData((d) => (d ? patchRoom(d, room.key, { muted: next }) : d))
      setSearch((s) => (s?.data ? { ...s, data: patchRoom(s.data, room.key, { muted: next }) } : s))
      try {
        await chatPrefs.setMuted(room.key, next)
        if (room.key === activeKey) router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "알림 설정을 바꾸지 못했습니다")
      }
      void load()
    },
    [load, activeKey, router],
  )
  /** 열린 줄(밀어 둔 줄) — 한 번에 하나 */
  const [swiped, setSwiped] = useState<{ key: string; side: SwipeSide } | null>(null)
  /** 확인 창(규칙 11) — 누른 줄과 그 동작 */
  const [confirm, setConfirm] = useState<{ room: RoomListItem; removal: RoomRemoval } | null>(null)
  const [removing, setRemoving] = useState(false)

  const removeRoom = useCallback(
    async (room: RoomListItem, removal: RoomRemoval) => {
      setRemoving(true)
      try {
        if (removal === "leave") await chatPrefs.leaveGroup(room.id)
        else await chatPrefs.hide(room.key)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "처리하지 못했습니다")
        setRemoving(false)
        return
      }
      // 목록에서 바로 뺀다 — 성공 토스트는 띄우지 않는다(바뀐 것이 그 자리에 보인다)
      const drop = (d: RoomListData | null) =>
        d ? { ...d, omnis: d.omnis.filter((r) => r.key !== room.key), groups: d.groups.filter((r) => r.key !== room.key) } : d
      setData(drop)
      setSearch((s) => (s ? { ...s, data: drop(s.data) } : s))
      setSwiped(null)
      setConfirm(null)
      setRemoving(false)
      if (room.key === activeKey) router.push("/chat")
      void load()
    },
    [activeKey, load, router],
  )

  // ─── 그릴 것 ───
  const searching = trimmed.length > 0
  const withActiveRead = (r: RoomListItem) => (r.key === activeKey && r.unread > 0 ? { ...r, unread: 0 } : r)
  const visible = searching
    ? sortByRecent(flatten(search?.data ?? null)).map(withActiveRead)
    : roomsInChip(rooms.map(withActiveRead), chip, folders)
  const unreadRooms = unreadRoomCount(rooms.map(withActiveRead))
  const loading = searching ? !search?.data && !search?.error : data === null && !error
  const currentFolder = chip.startsWith("folder:") ? folders.find((f) => `folder:${f.id}` === chip) : undefined
  const showNewChat = !searching && (chip === "all" || chip === "omnis")
  // 업무방은 상태별 접는 묶음으로(groupTaskRooms). 기본은 모두 접힘. 검색 결과는 찾은 그대로 한 목록이다
  const { open: openRooms, groups: taskGroups } = searching ? { open: visible, groups: [] } : groupTaskRooms(visible)
  const [openGroups, setOpenGroups] = useState<TaskGroupStatus[]>([])
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(taskGroupsStorageKey(userId)) ?? "[]")
      if (Array.isArray(saved)) setOpenGroups(saved.filter((s): s is TaskGroupStatus => typeof s === "string"))
    } catch {
      // 저장소를 못 읽으면 모두 접은 채로 시작한다
    }
  }, [userId])
  const toggleGroup = useCallback(
    (status: TaskGroupStatus) => {
      setOpenGroups((prev) => {
        const next = prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
        try {
          window.localStorage.setItem(taskGroupsStorageKey(userId), JSON.stringify(next))
        } catch {
          // 펼침 상태는 이번 세션에만 남는다
        }
        return next
      })
    },
    [userId],
  )
  const renderRow = (r: RoomListItem) => (
    <RoomRow
      key={r.key}
      room={r}
      active={r.key === activeKey}
      folders={folders}
      swiped={swiped?.key === r.key ? swiped.side : null}
      onSwipe={(side) => setSwiped(side ? { key: r.key, side } : null)}
      onFavorite={() => void toggleFavorite(r)}
      onMute={() => void toggleMuted(r)}
      onFolder={(f) => void toggleFolder(r, f)}
      onNewFolder={() => setManager({ open: true })}
      onRemove={(removal) => setConfirm({ room: r, removal })}
    />
  )

  // 폰에서 처음 그릴 때 검색칸을 위로 밀어 둔다. 목록은 방을 옮겨 다녀도 그대로라(MessengerShell) 한 번이면 된다.
  // isMdUp 은 첫 그림에서 아직 false 라 여기서는 매체 질의를 직접 본다
  useLayoutEffect(() => {
    const nav = listRef.current
    const box = searchRef.current
    if (nav && box && !window.matchMedia(NAV_DESKTOP_QUERY).matches) nav.scrollTop = box.offsetHeight
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b pt-3 pb-2.5">
        <div className="min-w-0 flex-1">
          <ChipBar
            chip={chip}
            onSelect={selectChip}
            folders={folders}
            unreadRooms={unreadRooms}
            dimmed={searching}
            onManage={() => setManager({ open: true })}
          />
        </div>
        {!isMdUp && (
          // 다른 화면 제목줄의 알림 종과 같은 유리 원(.glass, header.tsx) — 아이콘은 원 한가운데
          <div className="glass mr-3 flex size-12 shrink-0 items-center justify-center rounded-full [@media(pointer:coarse)]:size-[50px] [&_button]:size-full! [&_button]:rounded-full">
            <NotificationBell />
          </div>
        )}
      </div>

      {/* 폰: 검색칸 · 목록 두 곳에 걸쇠(snap)를 걸어, 검색칸이 반쯤 걸쳐 멈추지 않고 다 나오거나 다 숨는다 */}
      <nav
        ref={listRef}
        aria-label="채팅방"
        className="min-h-0 flex-1 overflow-y-auto max-md:snap-y max-md:snap-proximity overscroll-contain pb-28"
      >
        <div ref={searchRef} className="snap-start pt-2">
          <SearchBox value={query} onChange={setQuery} />
        </div>
        {/* 폰: 방이 몇 개 없어도 검색칸을 숨길 만큼은 스크롤되게 목록 칸을 화면 높이 이상으로 둔다 */}
        <div className="snap-start max-md:min-h-full">
          {error && !data && !searching && <ErrorBox message={error} onRetry={() => void load()} />}
          {searching && search?.error && <ErrorBox message={search.error} onRetry={() => setSearchTry((n) => n + 1)} />}

          {searching && (
            <p className="px-4 pb-2 text-[13px] text-muted-foreground" aria-live="polite">
              {search?.data ? `전체에서 찾은 방 ${visible.length}개` : "찾는 중…"}
            </p>
          )}

          <div className="flex flex-col gap-0.5">
            {showNewChat && <NewChatRow active={pathname === "/chat/new"} />}
            {loading ? (
              <RowSkeletons count={6} />
            ) : visible.length === 0 ? (
              <EmptyState
                searching={searching}
                query={trimmed}
                chip={chip}
                folder={currentFolder}
                onPickRooms={
                  currentFolder && !currentFolder.rule ? () => setManager({ open: true, pickFolderId: currentFolder.id }) : undefined
                }
              />
            ) : (
              <>
                {openRooms.map(renderRow)}
                {taskGroups.map((g, i) => (
                  <TaskStatusGroup
                    key={g.status}
                    status={g.status}
                    rooms={g.rooms}
                    first={i === 0}
                    // 지금 연 방이 든 묶음은 펼쳐 둔다 — 연 방이 목록에서 안 보이면 어디 있는지 모른다
                    open={openGroups.includes(g.status) || g.rooms.some((r) => r.key === activeKey)}
                    onToggle={() => toggleGroup(g.status)}
                  >
                    {g.rooms.map(renderRow)}
                  </TaskStatusGroup>
                ))}
              </>
            )}
          </div>
        </div>
      </nav>

      <RemoveConfirm
        target={confirm}
        busy={removing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && void removeRoom(confirm.room, confirm.removal)}
      />

      <FolderManager
        onCreated={(id) => selectChip(`folder:${id}`)}
        open={manager.open}
        pickFolderId={manager.pickFolderId}
        onOpenChange={(open) =>
          setManager((m) => ({
            ...m,
            open,
            pickFolderId: open ? m.pickFolderId : undefined,
          }))
        }
        folders={folders}
        rooms={rooms}
        onChanged={load}
      />
    </div>
  )
}

// ─── 검색칸 · 칩 ───────────────────────────────────────────

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="search" className="relative mx-3 mb-2.5">
      <HugeiconsIcon
        icon={Search01Icon}
        size={18}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault()
            onChange("")
          }
        }}
        placeholder="방 · 업무 · 마지막 글 검색"
        aria-label="채팅방 검색"
        className="touch-target h-[50px] rounded-xl pr-12 pl-12 text-[16px] md:text-[16px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="검색어 지우기"
          className="touch-target absolute top-1/2 right-0 flex size-[50px] -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}

// justify-center: 터치 기기에서 .touch-target 이 칸을 44px 로 넓히면 아이콘만 든 칩(폴더 관리)의 아이콘이
// 왼쪽에 붙어 원 가운데에서 벗어났다(2026-10-29 작업지시자 스크린샷)
const CHIP =
  "touch-target inline-flex h-[36px] [@media(pointer:coarse)]:h-[48px] shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 text-[14.5px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const CHIP_ON = "border-foreground bg-foreground text-background"
const CHIP_OFF = "border-border bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"

function ChipBar({
  chip,
  onSelect,
  folders,
  unreadRooms,
  dimmed,
  onManage,
}: {
  chip: ChipId
  onSelect: (c: ChipId) => void
  folders: ChatFolderView[]
  unreadRooms: number
  dimmed: boolean
  onManage: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)
  // 줄 밖으로 넘친 칩이 있는 쪽. 스크롤바를 숨겨 두어 이것이 없으면 넘친 칩이 있는지 보이지 않는다 —
  // 1440px 목록 칸에서 고정 칩 넷이 줄을 다 채워 새 폴더 칩이 줄 밖(282~340px, 줄 끝 281px)에 그려졌는데
  // PC 마우스 휠은 세로로만 굴러 영영 볼 수 없었다(2026-10-29 작업지시자 제보)
  const [edge, setEdge] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = barRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  // 고른 칩이 줄 밖에 있으면(저장해 둔 폴더 칩 · 방금 만든 폴더) 보이게 민다. 줄만 밀고 페이지는 움직이지 않는다
  useEffect(() => {
    const el = barRef.current
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && on) {
      const l = on.offsetLeft - el.offsetLeft
      if (l < el.scrollLeft) el.scrollLeft = l - 12
      else if (l + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = l + on.offsetWidth - el.clientWidth + 12
    }
    measure()
  }, [chip, folders, measure])

  // 세로 휠을 가로 스크롤로 — 마우스만 있는 PC 에서도 넘친 칩까지 간다. React 의 onWheel 은 passive 라 막을 수 없어 직접 단다
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("scroll", measure, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("scroll", measure)
    }
  }, [measure])

  const scrollBy = (dir: -1 | 1) => barRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" })

  const chips: { id: ChipId; label: string; badge?: number }[] = [
    ...FIXED_CHIPS.map((c) => ({
      id: c.id as ChipId,
      label: c.label,
      badge: c.id === "unread" ? unreadRooms : undefined,
    })),
    ...folders.map((f) => ({ id: `folder:${f.id}` as ChipId, label: f.name })),
  ]

  // 폴더 관리는 칩 줄 끝에 붙여 두되 스크롤 밖에 둔다 — 칩이 넘쳐도 늘 보인다
  return (
    <div className="flex min-w-0 items-center gap-1.5 pr-3">
      <div className="relative flex min-w-0 flex-1">
        <div
          ref={barRef}
          role="group"
          aria-label="방 거르기"
          data-overflow-left={edge.left || undefined}
          data-overflow-right={edge.right || undefined}
          style={{ maskImage: fadeMask(edge), WebkitMaskImage: fadeMask(edge) }}
          className={cn(
            "flex min-w-0 flex-1 [scrollbar-width:none] items-center gap-1.5 overflow-x-auto overscroll-x-contain pl-3 [&::-webkit-scrollbar]:hidden",
            dimmed && "opacity-60",
          )}
        >
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chip === c.id}
              onClick={() => onSelect(c.id)}
              title={dimmed ? "검색 중에는 전체에서 찾아요" : undefined}
              className={cn(CHIP, chip === c.id ? CHIP_ON : CHIP_OFF)}
            >
              <span className="max-w-[9rem] truncate">{c.label}</span>
              {c.badge ? (
                <span
                  aria-label={`안 읽은 방 ${c.badge}개`}
                  className="rounded-full bg-primary px-2 text-[12px] leading-5 font-semibold text-primary-foreground tabular-nums"
                >
                  {unreadLabel(c.badge)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        {/* PC 에서 넘친 쪽을 알리고 누르면 민다. 터치 기기는 손가락으로 밀어 두지 않는다(44px 칸을 줄 위에 겹치지 않게) */}
        {edge.left && <ScrollNudge side="left" onClick={() => scrollBy(-1)} />}
        {edge.right && <ScrollNudge side="right" onClick={() => scrollBy(1)} />}
      </div>
      <button type="button" onClick={onManage} aria-label="폴더 관리" title="폴더 관리" className={cn(CHIP, CHIP_OFF, "px-3")}>
        <HugeiconsIcon icon={FolderLibraryIcon} size={18} aria-hidden />
        <span className="sr-only">폴더 관리</span>
      </button>
    </div>
  )
}

/** 넘친 쪽 끝을 흐리게 — 칩이 더 있다는 표시 */
function fadeMask(edge: { left: boolean; right: boolean }): string | undefined {
  if (!edge.left && !edge.right) return undefined
  return `linear-gradient(to right, ${edge.left ? "transparent, #000 28px" : "#000"}, ${edge.right ? "#000 calc(100% - 28px), transparent" : "#000"})`
}

function ScrollNudge({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "앞 칩 보기" : "뒤 칩 더 보기"}
      className={cn(
        "absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:hidden",
        side === "left" ? "left-1" : "right-0",
      )}
    >
      <HugeiconsIcon icon={side === "left" ? ArrowLeft01Icon : ArrowRight01Icon} size={16} aria-hidden />
    </button>
  )
}

// ─── 줄 ────────────────────────────────────────────────

// 터치 기기에서 44px — .touch-target 은 px 고정이라 rem 배율(81.25%)을 타지 않는다(ux-rules 30)
// 줄 높이 88px = 아이콘 52px + 위아래 18px. 폰에서 Gemini · 카톡 목록처럼 한 줄이 손가락 크기가 되게 키웠다(2026-10-30 작업지시자).
// 크기는 모두 px — size-8 같은 rem 유틸리티는 html 81.25% 를 타 의도한 크기가 안 나온다
const ROW =
  "touch-target flex min-w-0 flex-1 items-center gap-3.5 rounded-xl px-3 py-[18px] text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const ROW_WRAP = "group/row mx-2 flex items-center rounded-xl hover:bg-muted/60"
const ROW_ACTIVE = "bg-muted hover:bg-muted"

function NewChatRow({ active }: { active: boolean }) {
  return (
    <div className={cn(ROW_WRAP, active && ROW_ACTIVE)}>
      <Link href="/chat/new" aria-current={active ? "page" : undefined} className={ROW}>
        <RoomIcon className="bg-primary/10 text-primary">
          <HugeiconsIcon icon={PencilEdit02Icon} size={26} aria-hidden />
        </RoomIcon>
        <span className="min-w-0 flex-1">
          <span className="block text-[16.5px] font-medium">새 대화</span>
          <span className="mt-0.5 block truncate text-[14.5px] text-muted-foreground">옴니스에게 회사 일을 물어보세요</span>
        </span>
      </Link>
    </div>
  )
}

function RoomIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span aria-hidden className={cn("flex size-[52px] shrink-0 items-center justify-center rounded-full", className)}>
      {children}
    </span>
  )
}

function kindIcon(kind: RoomListItem["kind"]) {
  if (kind === "OMNIS_DM")
    return (
      <RoomIcon className="ai-rainbow-border bg-primary/10 text-primary">
        <HugeiconsIcon icon={BubbleChatSparkIcon} size={26} />
      </RoomIcon>
    )
  if (kind === "COMPANY")
    return (
      <RoomIcon className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <HugeiconsIcon icon={Building03Icon} size={26} />
      </RoomIcon>
    )
  if (kind === "TASK")
    return (
      <RoomIcon className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <HugeiconsIcon icon={Task01Icon} size={26} />
      </RoomIcon>
    )
  return (
    <RoomIcon className="bg-muted text-muted-foreground">
      <HugeiconsIcon icon={UserGroupIcon} size={26} />
    </RoomIcon>
  )
}

/** 목록 한 줄 머리 — 사람끼리 1:1 은 상대 아바타(이름 색 · 두 글자), 나머지는 방 종류 아이콘 */
function roomIcon(room: RoomListItem) {
  if (room.kind === "DM") return <AuthorAvatar name={room.name} size={52} />
  return kindIcon(room.kind)
}

interface RowActions {
  folders: ChatFolderView[]
  onFavorite: () => void
  /** 이 방의 채팅 푸시 끄기 · 켜기 */
  onMute: () => void
  onFolder: (f: ChatFolderView) => void
  onNewFolder: () => void
  /** 지우기 · 숨기기 · 나가기 — 확인 창을 연다. 동작이 없는 방(전사방 · 업무방)은 부르지 않는다 */
  onRemove: (removal: RoomRemoval) => void
}

const REMOVAL_LABEL: Record<RoomRemoval, string> = { delete: "삭제", hide: "숨기기", leave: "나가기" }
/** 밀었을 때 드러나는 칸 폭(px) — 오른쪽 한 칸 · 왼쪽 세 칸(즐겨찾기 · 알림 · 폴더) */
const RIGHT_W = 100
const LEFT_W = 276

/**
 * 목록 한 줄. ⋯ 더보기 단추는 없다(2026-10-29 작업지시자) — 대신
 *   꾹 누르기(PC 는 우클릭 · 키보드는 Shift+F10) = 메뉴 · 오른쪽→왼쪽 밀기 = 삭제/숨기기/나가기 · 왼쪽→오른쪽 밀기 = 즐겨찾기 · 알림 · 폴더.
 * 메뉴와 밀기는 같은 동작을 부른다(RoomMenuBody · onRemove). 꾹 누르기는 base-ui ContextMenu 가 터치에서 0.5초로 연다
 */
function RoomRow({
  room,
  active,
  swiped,
  onSwipe,
  ...actions
}: { room: RoomListItem; active: boolean; swiped: SwipeSide | null; onSwipe: (side: SwipeSide | null) => void } & RowActions) {
  const removal = roomRemoval(room.kind)
  const manual = actions.folders.filter((f) => !f.rule)
  const startEntry = useStartRoomEntry()
  return (
    <ContextMenu>
      <ContextMenuTrigger className="mx-2 rounded-xl">
        <SwipeRow
          open={swiped}
          onOpenChange={onSwipe}
          className="rounded-xl"
          leftWidth={LEFT_W}
          rightWidth={removal ? RIGHT_W : 0}
          left={
            <>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => {
                  actions.onFavorite()
                  onSwipe(null)
                }}
                className="flex flex-1 flex-col items-center justify-center gap-1 bg-amber-500 text-[13.5px] font-medium text-white"
              >
                <HugeiconsIcon icon={StarIcon} size={24} aria-hidden className={room.favorite ? "fill-white" : undefined} />
                {room.favorite ? "즐겨찾기 끄기" : "즐겨찾기"}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-mute-room={room.muted ? "on" : "off"}
                onClick={() => {
                  actions.onMute()
                  onSwipe(null)
                }}
                className="flex flex-1 flex-col items-center justify-center gap-1 bg-slate-600 text-[13.5px] font-medium text-white"
              >
                <HugeiconsIcon icon={room.muted ? Notification03Icon : NotificationOff03Icon} size={24} aria-hidden />
                {room.muted ? "알림 켜기" : "알림 끄기"}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  tabIndex={-1}
                  className="flex flex-1 flex-col items-center justify-center gap-1 bg-sky-600 text-[13.5px] font-medium text-white"
                >
                  <HugeiconsIcon icon={FolderLibraryIcon} size={24} aria-hidden />
                  폴더
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>폴더에 넣기</DropdownMenuLabel>
                    {manual.map((f) => (
                      <DropdownMenuCheckboxItem
                        key={f.id}
                        checked={f.roomKeys.includes(room.key)}
                        onCheckedChange={() => actions.onFolder(f)}
                        closeOnClick
                        className="touch-target"
                      >
                        <span className="truncate">{f.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuItem onClick={actions.onNewFolder} className="touch-target text-muted-foreground">
                      <HugeiconsIcon icon={FolderLibraryIcon} size={14} aria-hidden />
                      {manual.length === 0 ? "폴더 만들기…" : "폴더 관리…"}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          right={
            removal ? (
              <button
                type="button"
                tabIndex={-1}
                data-remove-room={removal}
                onClick={() => actions.onRemove(removal)}
                className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-[14px] font-semibold text-white"
              >
                <HugeiconsIcon icon={removal === "leave" ? Logout03Icon : Delete02Icon} size={24} aria-hidden />
                {REMOVAL_LABEL[removal]}
              </button>
            ) : undefined
          }
        >
          <div className={cn("rounded-xl hover:bg-muted/60 has-data-[pending]:bg-muted", active && ROW_ACTIVE)}>
            <Link
              href={roomHref(room)}
              aria-current={active ? "page" : undefined}
              draggable={false}
              aria-keyshortcuts="Shift+F10"
              onClick={(e) => {
                // 새 탭 · 새 창으로 여는 누르기는 이 화면을 바꾸지 않는다
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                startEntry(room.key)
              }}
              onKeyDown={(e) => {
                // 키보드로 메뉴 — 메뉴 키 · Shift+F10. 브라우저마다 contextmenu 를 내지 않는 경우가 있어 직접 연다
                if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  e.currentTarget.dispatchEvent(
                    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 24, clientY: r.top + r.height / 2 }),
                  )
                }
              }}
              className={ROW}
            >
              <RoomRowContent room={room} />
              {/* 누르는 즉시 줄이 눌린 색 — 방 화면이 오기 전에도 받은 것이 보인다 */}
              <LinkPendingMark />
            </Link>
          </div>
        </SwipeRow>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <RoomMenuBody room={room} {...actions} ui={CONTEXT_UI} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** 목록 한 줄의 보이는 부분 — 아이콘 · 이름 · 시각 · 미리보기 · 안 읽음. RoomRow 와 랜딩 시연(RoomRowPreview)이 함께 쓴다 */
function RoomRowContent({ room }: { room: RoomListItem }) {
  const unread = room.unread > 0
  return (
    <>
      {roomIcon(room)}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-[16.5px]", unread ? "font-semibold" : "font-medium")}>
            {room.kind === "TASK" && <span className="mr-0.5 text-muted-foreground">#</span>}
            {room.name}
          </span>
          {room.favorite && (
            <HugeiconsIcon
              icon={StarIcon}
              size={15}
              aria-label="즐겨찾기"
              className="shrink-0 self-center fill-amber-400 text-amber-500"
            />
          )}
          {room.muted && (
            <HugeiconsIcon
              icon={NotificationOff03Icon}
              size={15}
              aria-label="알림 꺼짐"
              className="shrink-0 self-center text-muted-foreground"
            />
          )}
          <time dateTime={room.lastAt} className="shrink-0 text-[12.5px] text-muted-foreground tabular-nums">
            {listTime(room.lastAt)}
          </time>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          {room.status && (
            <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[12px] text-muted-foreground">
              {TASK_STATUS_LABELS[room.status] ?? room.status}
            </span>
          )}
          <span className={cn("min-w-0 flex-1 truncate text-[14.5px]", unread ? "text-foreground/80" : "text-muted-foreground")}>
            {room.preview ?? "아직 글이 없어요"}
          </span>
          {unread && (
            <Badge className="h-[22px] min-w-[22px] shrink-0 px-1.5 text-[12px] tabular-nums" aria-label={`안 읽은 글 ${room.unread}개`}>
              {unreadLabel(room.unread)}
            </Badge>
          )}
        </span>
      </span>
    </>
  )
}

/**
 * 동작 없이 모양만 있는 목록 한 줄 — 랜딩의 업무 시연(components/landing/motion/workflow-film.tsx)이 실제 목록과
 * 같은 모양을 쓰려고 부른다. 메뉴 · 밀기 · 링크가 없다
 */
export function RoomRowPreview({ room, active = false }: { room: RoomListItem; active?: boolean }) {
  return (
    <div className={cn("mx-2 rounded-xl", active && ROW_ACTIVE)}>
      <div className={ROW}>
        <RoomRowContent room={room} />
      </div>
    </div>
  )
}

// 꾹 누르기 · 우클릭 메뉴. 밀기 칸과 같은 동작을 부른다
const CONTEXT_UI = {
  Group: ContextMenuGroup,
  Label: ContextMenuLabel,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Separator: ContextMenuSeparator,
}

function RoomMenuBody({
  room,
  folders,
  onFavorite,
  onMute,
  onFolder,
  onNewFolder,
  onRemove,
  ui,
}: { room: RoomListItem; ui: typeof CONTEXT_UI } & RowActions) {
  const manual = folders.filter((f) => !f.rule)
  const ruled = folders.filter((f) => f.rule && folderHasRoom(f, room))
  const removal = roomRemoval(room.kind)
  return (
    <>
      <ui.Item onClick={onFavorite} className="touch-target">
        <HugeiconsIcon icon={StarIcon} size={14} aria-hidden className={room.favorite ? "fill-amber-400 text-amber-500" : undefined} />
        {room.favorite ? "즐겨찾기 끄기" : "즐겨찾기"}
      </ui.Item>
      <ui.Item onClick={onMute} className="touch-target">
        <HugeiconsIcon icon={room.muted ? Notification03Icon : NotificationOff03Icon} size={14} aria-hidden />
        {room.muted ? "알림 켜기" : "알림 끄기"}
      </ui.Item>
      <ui.Separator />
      <ui.Group>
        <ui.Label>폴더에 넣기</ui.Label>
        {manual.map((f) => (
          <ui.CheckboxItem
            key={f.id}
            checked={f.roomKeys.includes(room.key)}
            onCheckedChange={() => onFolder(f)}
            closeOnClick
            className="touch-target"
          >
            <span className="truncate">{f.name}</span>
          </ui.CheckboxItem>
        ))}
        {ruled.map((f) => (
          <ui.Item key={f.id} disabled className="touch-target">
            <span className="truncate">{f.name}</span>
            <span className="ml-auto text-[11px]">자동</span>
          </ui.Item>
        ))}
        <ui.Item onClick={onNewFolder} className="touch-target text-muted-foreground">
          <HugeiconsIcon icon={FolderLibraryIcon} size={14} aria-hidden />
          {manual.length === 0 ? "폴더 만들기…" : "폴더 관리…"}
        </ui.Item>
      </ui.Group>
      {removal && (
        <>
          <ui.Separator />
          <ui.Item onClick={() => onRemove(removal)} className="touch-target text-destructive focus:text-destructive">
            <HugeiconsIcon icon={removal === "leave" ? Logout03Icon : Delete02Icon} size={14} aria-hidden />
            {removal === "delete" ? "대화 삭제" : removal === "hide" ? "목록에서 숨기기" : "채팅방 나가기"}
          </ui.Item>
        </>
      )}
    </>
  )
}

/** 지우기 · 숨기기 · 나가기 확인(규칙 11 — 브라우저 confirm 을 쓰지 않는다) */
function RemoveConfirm({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { room: RoomListItem; removal: RoomRemoval } | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const r = target?.removal
  const name = target?.room.name ?? ""
  const text =
    r === "delete"
      ? { title: "이 대화를 삭제할까요?", body: "내 목록에서 사라지고 다시 열 수 없어요. 옴니스가 이 대화에서 한 일(업무 변경 등)은 그대로 남습니다.", action: "삭제" }
      : r === "hide"
        ? { title: `「${name}」 님과의 대화를 목록에서 숨길까요?`, body: "대화는 지워지지 않아요. 상대가 새 글을 보내면 목록에 다시 나타납니다.", action: "숨기기" }
        : { title: `「${name}」 에서 나갈까요?`, body: "내 목록에서 이 방과 즐겨찾기 · 폴더 표시가 사라지고 더는 글을 볼 수 없어요. 다시 들어오려면 참여자가 초대해야 해요.", action: "나가기" }
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text.title}</AlertDialogTitle>
          <AlertDialogDescription>{text.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy && <Spinner className="size-3.5" />}
            {text.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── 상태 ────────────────────────────────────────────────

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-3 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-3.5 text-[14.5px]">
      <p className="text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="touch-target mt-2" onClick={onRetry}>
        다시 불러오기
      </Button>
    </div>
  )
}

const TASK_GROUP_LABEL: Record<TaskGroupStatus, string> = {
  IN_PROGRESS: "진행 중인 업무",
  REVIEW: "리뷰 중인 업무",
  TODO: "할 일",
  DONE: "완료된 업무",
}

/**
 * 업무방 상태별 묶음 — 접어 두면 머리 한 줄(상태 · 개수 · 안 읽은 방)만. 펼침은 기기에 남긴다.
 * 안 읽은 글이 있으면 접힌 머리에도 배지를 둔다 — 접어 둔 업무에 누가 글을 남겼는지 놓치지 않게
 */
function TaskStatusGroup({
  status,
  rooms,
  first,
  open,
  onToggle,
  children,
}: {
  status: TaskGroupStatus
  rooms: RoomListItem[]
  first: boolean
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const unreadRooms = unreadRoomCount(rooms)
  const listId = `task-rooms-${status}`
  return (
    <div className={cn(first ? "mt-2 border-t pt-2" : "pt-0.5")} data-task-group={status}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        className="touch-target mx-2 flex w-[calc(100%-1rem)] items-center gap-2.5 rounded-xl px-3 py-3 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={16}
          aria-hidden
          className={cn("shrink-0 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-90")}
        />
        <HugeiconsIcon icon={status === "DONE" ? CheckmarkCircle02Icon : Task01Icon} size={17} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{TASK_GROUP_LABEL[status]}</span>
        {unreadRooms > 0 && !open && (
          <Badge className="h-5 min-w-5 shrink-0 px-1.5 text-[12px] tabular-nums" aria-label={`안 읽은 방 ${unreadRooms}개`}>
            {unreadLabel(unreadRooms)}
          </Badge>
        )}
        <span className="shrink-0 rounded-full bg-muted px-2 text-[12.5px] leading-6 tabular-nums" aria-label={`${rooms.length}개`}>
          {rooms.length}
        </span>
      </button>
      {open && (
        <div id={listId} className="flex flex-col gap-0.5">
          {children}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  searching,
  query,
  chip,
  folder,
  onPickRooms,
}: {
  searching: boolean
  query: string
  chip: ChipId
  folder?: ChatFolderView
  onPickRooms?: () => void
}) {
  let text: string
  if (searching) text = `「${query}」 에 맞는 방이 없어요. 방 이름 · 업무 이름 · 슬러그 · 마지막 글로 찾아요`
  else if (chip === "omnis") text = "옴니스와 나눈 대화가 여기에 모여요"
  else if (chip === "unread") text = "안 읽은 글이 없어요"
  else if (chip === "favorite") text = "방을 오른쪽으로 밀거나 꾹 눌러 즐겨찾기를 켜면 여기에 모여요"
  else if (folder?.rule === "MY_TASKS") text = "내가 담당이거나 지시한 업무에 아직 글이 없어요. 업무 스레드에 글이 생기면 저절로 들어와요"
  else if (folder?.rule === "PROJECT" && !folder.project) text = "이 폴더의 프로젝트가 지워졌어요. 폴더 관리에서 지울 수 있어요"
  else if (folder?.rule === "PROJECT" && folder.project)
    text = `「${folder.project.name}」 업무방에 아직 글이 없어요. 업무 스레드에 글이 생기면 저절로 들어와요`
  else if (folder) text = "이 폴더에 방이 없어요. 방을 꾹 누르거나 오른쪽으로 밀어서, 또는 아래 버튼으로 넣을 수 있어요"
  else text = "아직 방이 없어요"
  return (
    <div className="mx-4 mt-1 rounded-md border border-dashed px-3.5 py-3.5 text-[14px] text-muted-foreground">
      <p>{text}</p>
      {onPickRooms && (
        <Button variant="outline" size="sm" className="touch-target mt-2" onClick={onPickRooms}>
          방 고르기
        </Button>
      )}
    </div>
  )
}

function RowSkeletons({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="mx-2 flex items-center gap-3.5 px-3 py-[18px]" aria-hidden>
          <Skeleton className="size-[52px] shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-2.5">
            <Skeleton className="h-[17px] w-2/3" />
            <Skeleton className="h-[14px] w-full" />
          </span>
        </div>
      ))}
    </>
  )
}
