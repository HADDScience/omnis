"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  BubbleChatSparkIcon,
  Building03Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  FolderLibraryIcon,
  MoreHorizontalIcon,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  roomsInChip,
  sortByRecent,
  unreadLabel,
  unreadRoomCount,
  type ChatFolderView,
  type ChipId,
} from "@/lib/chat-list"
import type { RoomList as RoomListData, RoomListItem } from "@/lib/chat-rooms"
import { chatPrefs } from "./chat-prefs-client"
import { FolderManager } from "./folder-manager"
import { AuthorAvatar } from "@/components/chat/message-parts"

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

/**
 * 메신저 왼쪽 목록 — 검색칸 · 칩 한 줄(전체 · 옴니스 · 안읽음 · 즐겨찾기 · 내 폴더 · 폴더 관리) · 방 목록.
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
  const [manager, setManager] = useState<{
    open: boolean
    pickFolderId?: string
  }>({ open: false })

  const load = useCallback(async () => {
    try {
      const res = await fetch(apiUrl("/api/chat/rooms"))
      if (!res.ok) throw new Error(`목록을 불러오지 못했습니다 (${res.status})`)
      setData((await res.json()) as RoomListData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "목록을 불러오지 못했습니다")
    }
  }, [])

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b pt-2.5 pb-2">
        <SearchBox value={query} onChange={setQuery} />
        <ChipBar
          chip={chip}
          onSelect={selectChip}
          folders={folders}
          unreadRooms={unreadRooms}
          dimmed={searching}
          onManage={() => setManager({ open: true })}
        />
      </div>

      <nav aria-label="채팅방" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-20">
        {error && !data && !searching && <ErrorBox message={error} onRetry={() => void load()} />}
        {searching && search?.error && <ErrorBox message={search.error} onRetry={() => setSearchTry((n) => n + 1)} />}

        {searching && (
          <p className="px-4 pb-1.5 text-[11px] text-muted-foreground" aria-live="polite">
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
            visible.map((r) => (
              <RoomRow
                key={r.key}
                room={r}
                active={r.key === activeKey}
                folders={folders}
                onFavorite={() => void toggleFavorite(r)}
                onFolder={(f) => void toggleFolder(r, f)}
                onNewFolder={() => setManager({ open: true })}
              />
            ))
          )}
        </div>
      </nav>

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
    <div role="search" className="relative mx-3 mb-2">
      <HugeiconsIcon
        icon={Search01Icon}
        size={14}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
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
        className="touch-target h-8 pr-8 pl-8 text-[12.5px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="검색어 지우기"
          className="touch-target absolute top-1/2 right-0 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={13} aria-hidden />
        </button>
      )}
    </div>
  )
}

// justify-center: 터치 기기에서 .touch-target 이 칸을 44px 로 넓히면 아이콘만 든 칩(폴더 관리)의 아이콘이
// 왼쪽에 붙어 원 가운데에서 벗어났다(2026-10-29 작업지시자 스크린샷)
const CHIP =
  "touch-target inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
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
                  className="rounded-full bg-primary px-1.5 text-[10px] leading-4 font-semibold text-primary-foreground tabular-nums"
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
      <button type="button" onClick={onManage} aria-label="폴더 관리" title="폴더 관리" className={cn(CHIP, CHIP_OFF, "px-2")}>
        <HugeiconsIcon icon={FolderLibraryIcon} size={14} aria-hidden />
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
        "absolute top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:hidden",
        side === "left" ? "left-1" : "right-0",
      )}
    >
      <HugeiconsIcon icon={side === "left" ? ArrowLeft01Icon : ArrowRight01Icon} size={12} aria-hidden />
    </button>
  )
}

// ─── 줄 ────────────────────────────────────────────────

// 터치 기기에서 44px — .touch-target 은 px 고정이라 rem 배율(81.25%)을 타지 않는다(ux-rules 30)
const ROW =
  "touch-target flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const ROW_WRAP = "group/row mx-2 flex items-center rounded-lg hover:bg-muted/60"
const ROW_ACTIVE = "bg-muted hover:bg-muted"

function NewChatRow({ active }: { active: boolean }) {
  return (
    <div className={cn(ROW_WRAP, active && ROW_ACTIVE)}>
      <Link href="/chat/new" aria-current={active ? "page" : undefined} className={ROW}>
        <RoomIcon className="bg-primary/10 text-primary">
          <HugeiconsIcon icon={PencilEdit02Icon} size={16} aria-hidden />
        </RoomIcon>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">새 대화</span>
          <span className="block truncate text-[11.5px] text-muted-foreground">옴니스에게 회사 일을 물어보세요</span>
        </span>
      </Link>
    </div>
  )
}

function RoomIcon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span aria-hidden className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", className)}>
      {children}
    </span>
  )
}

function kindIcon(kind: RoomListItem["kind"]) {
  if (kind === "OMNIS_DM")
    return (
      <RoomIcon className="ai-rainbow-border bg-primary/10 text-primary">
        <HugeiconsIcon icon={BubbleChatSparkIcon} size={16} />
      </RoomIcon>
    )
  if (kind === "COMPANY")
    return (
      <RoomIcon className="bg-sky-500/10 text-sky-700 dark:text-sky-300">
        <HugeiconsIcon icon={Building03Icon} size={16} />
      </RoomIcon>
    )
  if (kind === "TASK")
    return (
      <RoomIcon className="bg-amber-500/10 text-amber-700 dark:text-amber-300">
        <HugeiconsIcon icon={Task01Icon} size={16} />
      </RoomIcon>
    )
  return (
    <RoomIcon className="bg-muted text-muted-foreground">
      <HugeiconsIcon icon={UserGroupIcon} size={16} />
    </RoomIcon>
  )
}

/** 목록 한 줄 머리 — 사람끼리 1:1 은 상대 아바타(이름 색 · 두 글자), 나머지는 방 종류 아이콘 */
function roomIcon(room: RoomListItem) {
  if (room.kind === "DM") return <AuthorAvatar name={room.name} size={32} />
  return kindIcon(room.kind)
}

interface RowActions {
  folders: ChatFolderView[]
  onFavorite: () => void
  onFolder: (f: ChatFolderView) => void
  onNewFolder: () => void
}

function RoomRow({ room, active, ...actions }: { room: RoomListItem; active: boolean } & RowActions) {
  const unread = room.unread > 0
  return (
    <ContextMenu>
      <ContextMenuTrigger className={cn(ROW_WRAP, active && ROW_ACTIVE)}>
        <Link href={roomHref(room)} aria-current={active ? "page" : undefined} className={ROW}>
          {roomIcon(room)}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5">
              <span className={cn("min-w-0 flex-1 truncate text-[13px]", unread ? "font-semibold" : "font-medium")}>
                {room.kind === "TASK" && <span className="mr-0.5 text-muted-foreground">#</span>}
                {room.name}
              </span>
              {room.favorite && (
                <HugeiconsIcon
                  icon={StarIcon}
                  size={11}
                  aria-label="즐겨찾기"
                  className="shrink-0 self-center fill-amber-400 text-amber-500"
                />
              )}
              <time dateTime={room.lastAt} className="shrink-0 text-[10.5px] text-muted-foreground tabular-nums">
                {listTime(room.lastAt)}
              </time>
            </span>
            <span className="flex items-center gap-1.5">
              {room.status && (
                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                  {TASK_STATUS_LABELS[room.status] ?? room.status}
                </span>
              )}
              <span className={cn("min-w-0 flex-1 truncate text-[11.5px]", unread ? "text-foreground/80" : "text-muted-foreground")}>
                {room.preview ?? "아직 글이 없어요"}
              </span>
              {unread && (
                <Badge className="h-4 min-w-4 shrink-0 px-1 text-[10px] tabular-nums" aria-label={`안 읽은 글 ${room.unread}개`}>
                  {unreadLabel(room.unread)}
                </Badge>
              )}
            </span>
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`${room.name} 메뉴`}
                className="touch-target mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-[popup-open]:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100"
              />
            }
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} size={15} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <RoomMenuBody room={room} {...actions} ui={DROPDOWN_UI} />
          </DropdownMenuContent>
        </DropdownMenu>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <RoomMenuBody room={room} {...actions} ui={CONTEXT_UI} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

// 우클릭 메뉴와 ⋯ 메뉴는 항목이 같다 — 부품만 다르다
const DROPDOWN_UI = {
  Group: DropdownMenuGroup,
  Label: DropdownMenuLabel,
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  Separator: DropdownMenuSeparator,
}
const CONTEXT_UI = {
  Group: ContextMenuGroup,
  Label: ContextMenuLabel,
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  Separator: ContextMenuSeparator,
} as unknown as typeof DROPDOWN_UI

function RoomMenuBody({
  room,
  folders,
  onFavorite,
  onFolder,
  onNewFolder,
  ui,
}: { room: RoomListItem; ui: typeof DROPDOWN_UI } & RowActions) {
  const manual = folders.filter((f) => !f.rule)
  const ruled = folders.filter((f) => f.rule && folderHasRoom(f, room))
  return (
    <>
      <ui.Item onClick={onFavorite} className="touch-target">
        <HugeiconsIcon icon={StarIcon} size={14} aria-hidden className={room.favorite ? "fill-amber-400 text-amber-500" : undefined} />
        {room.favorite ? "즐겨찾기 끄기" : "즐겨찾기"}
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
    </>
  )
}

// ─── 상태 ────────────────────────────────────────────────

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-3 mb-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12.5px]">
      <p className="text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="touch-target mt-2" onClick={onRetry}>
        다시 불러오기
      </Button>
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
  else if (chip === "favorite") text = "방의 ⋯ 메뉴에서 즐겨찾기를 켜면 여기에 모여요"
  else if (folder?.rule === "MY_TASKS") text = "내가 담당이거나 지시한 업무에 아직 글이 없어요. 업무 스레드에 글이 생기면 저절로 들어와요"
  else if (folder?.rule === "PROJECT" && !folder.project) text = "이 폴더의 프로젝트가 지워졌어요. 폴더 관리에서 지울 수 있어요"
  else if (folder?.rule === "PROJECT" && folder.project)
    text = `「${folder.project.name}」 업무방에 아직 글이 없어요. 업무 스레드에 글이 생기면 저절로 들어와요`
  else if (folder) text = "이 폴더에 방이 없어요. 방의 ⋯ 메뉴나 아래 버튼으로 넣을 수 있어요"
  else text = "아직 방이 없어요"
  return (
    <div className="mx-4 mt-1 rounded-md border border-dashed px-3 py-3 text-[11.5px] text-muted-foreground">
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
        <div key={i} className="mx-2 flex items-center gap-2.5 px-2 py-1.5" aria-hidden>
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2.5 w-full" />
          </span>
        </div>
      ))}
    </>
  )
}
