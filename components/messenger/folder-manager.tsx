"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowUp01Icon,
  Briefcase01Icon,
  Delete02Icon,
  Folder01Icon,
  MoreHorizontalIcon,
  PencilEdit01Icon,
  Tick02Icon,
  UserCheck01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { FOLDER_NAME_MAX, filterRooms, normalizeQuery, RULE_FOLDER_INFO, sortByRecent, type ChatFolderView } from "@/lib/chat-list"
import type { RoomListItem } from "@/lib/chat-rooms"
import { chatPrefs } from "./chat-prefs-client"

const RULE_ICON = { MY_TASKS: UserCheck01Icon, PROJECT: Briefcase01Icon } as const

/** 폴더 목록의 둘째 줄 — 무엇으로 채워지는지 */
function folderMeta(f: ChatFolderView): string {
  if (f.rule === "MY_TASKS") return "자동 · 내가 담당이거나 지시한 업무"
  if (f.rule === "PROJECT") {
    if (!f.project) return "자동 · 프로젝트가 지워졌어요 — 이 폴더는 비어 있어요"
    return f.project.archived ? `자동 · 보관된 프로젝트 「${f.project.name}」` : `자동 · 프로젝트 「${f.project.name}」`
  }
  return `방 ${f.roomKeys.length}개 · 직접 고른 방`
}

const errText = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback)

/**
 * 채팅방 폴더 관리 — 만들기 · 이름 바꾸기 · 지우기 · 순서 · 방 넣고 빼기 · 추천(규칙) 폴더 추가.
 * 폴더 = 내가 고른 방들을 묶는 상자. 직접 만든 폴더에는 옴니스 대화 · 업무방 · 전사방 · 단톡방을 섞어 넣는다.
 * 추천 폴더(내 업무 · 프로젝트별)는 규칙으로만 채워 방을 넣고 빼는 메뉴가 없다.
 * 폴더는 내 설정이다(남에게 보이지 않는다). 바꿀 때마다 서버에 바로 쓰고 목록을 다시 읽는다(onChanged).
 * 지우기는 창을 띄우지 않고 그 줄에서 한 번 더 묻는다(ux-rules 11).
 */
export function FolderManager({
  open,
  onOpenChange,
  folders,
  rooms,
  onChanged,
  onCreated,
  pickFolderId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: ChatFolderView[]
  rooms: RoomListItem[]
  onChanged: () => Promise<void>
  /** 폴더를 새로 만든 뒤 — 목록이 그 칩을 골라 칩 줄에서 보이게 민다 */
  onCreated: (folderId: string) => void
  /** 열자마자 이 폴더의 「방 고르기」 로 */
  pickFolderId?: string
}) {
  // 폴더 id 면 그 폴더의 방 고르기, "projects" 면 프로젝트 고르기
  const [picking, setPicking] = useState<string | null>(null)
  useEffect(() => {
    if (open) setPicking(pickFolderId ?? null)
  }, [open, pickFolderId])

  const pickFolder = picking && picking !== "projects" ? folders.find((f) => f.id === picking && !f.rule) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(640px,calc(var(--app-vh)-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {picking === "projects" ? (
          <ProjectPicker
            folders={folders}
            onBack={() => setPicking(null)}
            onChanged={onChanged}
            onCreated={(id) => {
              onCreated(id)
              setPicking(null)
            }}
          />
        ) : pickFolder ? (
          <RoomPicker folder={pickFolder} rooms={rooms} onBack={() => setPicking(null)} onChanged={onChanged} />
        ) : (
          <FolderList folders={folders} onChanged={onChanged} onCreated={onCreated} onPick={(id) => setPicking(id)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── 폴더 목록 ────────────────────────────────────────────

function FolderList({
  folders,
  onChanged,
  onCreated,
  onPick,
}: {
  folders: ChatFolderView[]
  onChanged: () => Promise<void>
  onCreated: (folderId: string) => void
  /** 폴더 id(방 고르기) 또는 "projects"(프로젝트 고르기) */
  onPick: (id: string) => void
}) {
  // 순서를 바꾸면 서버 응답 전에 먼저 그린다
  const [items, setItems] = useState(folders)
  useEffect(() => setItems(folders), [folders])
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // 성공은 알리지 않는다 — 바뀐 것이 그 자리에 보이고, 폰에서는 토스트가 칩 줄을 가린다
  // 목록을 다시 받은 뒤에 돌려준다 — 새 폴더 칩을 고를 때 목록에 그 폴더가 이미 있어야 「전체」 로 튕기지 않는다
  const run = async <T,>(work: () => Promise<T>, fail: string): Promise<T | null> => {
    setBusy(true)
    let out: T | null = null
    try {
      out = await work()
    } catch (err) {
      toast.error(errText(err, fail))
    } finally {
      await onChanged()
      setBusy(false)
    }
    return out
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const f = await run(() => chatPrefs.createFolder({ name }), "폴더를 만들지 못했습니다")
    if (f) {
      setNewName("")
      onCreated(f.id)
    }
  }

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[index], next[to]] = [next[to], next[index]]
    setItems(next)
    void run(() => chatPrefs.reorderFolders(next.map((f) => f.id)), "순서를 바꾸지 못했습니다")
  }

  const rename = () => {
    if (!renaming) return
    const name = renaming.name.trim()
    if (!name) return
    void run(() => chatPrefs.renameFolder(renaming.id, name), "이름을 바꾸지 못했습니다").then(() => setRenaming(null))
  }

  const hasMyTasks = items.some((f) => f.rule === "MY_TASKS")

  return (
    <>
      <DialogHeader className="border-b p-4 pr-12">
        <DialogTitle>채팅방 폴더</DialogTitle>
        <DialogDescription className="text-[12px]">내 목록에서만 보이는 폴더예요. 폴더마다 목록 위에 칩이 하나씩 생겨요.</DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        <h3 className="mb-1.5 text-[11px] font-semibold text-muted-foreground">내 폴더</h3>
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-2 text-[12px] text-muted-foreground">
            아직 폴더가 없어요. 아래에서 만들거나 추천 폴더를 추가해 보세요.
          </p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {items.map((f, i) => (
              <li key={f.id} className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">
                {confirmDelete === f.id ? (
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1">
                    <p className="min-w-0 flex-1 text-[12.5px]">
                      「{f.name}」 폴더를 지울까요? <span className="text-muted-foreground">안의 방은 그대로 남아요.</span>
                    </p>
                    <span className="flex shrink-0 gap-1.5">
                      <Button size="sm" variant="ghost" className="touch-target" onClick={() => setConfirmDelete(null)}>
                        취소
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="touch-target"
                        disabled={busy}
                        onClick={() =>
                          void run(() => chatPrefs.deleteFolder(f.id), "폴더를 지우지 못했습니다").then(() => setConfirmDelete(null))
                        }
                      >
                        지우기
                      </Button>
                    </span>
                  </div>
                ) : renaming?.id === f.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault()
                      rename()
                    }}
                  >
                    <Input
                      autoFocus
                      value={renaming.name}
                      maxLength={FOLDER_NAME_MAX}
                      onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault()
                          e.stopPropagation()
                          setRenaming(null)
                        }
                      }}
                      aria-label="새 폴더 이름"
                      className="touch-target h-8 min-w-0 flex-1 text-[12.5px]"
                    />
                    <Button type="submit" size="sm" className="touch-target" disabled={busy || !renaming.name.trim()}>
                      저장
                    </Button>
                  </form>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={f.rule ? RULE_ICON[f.rule] : Folder01Icon}
                      size={15}
                      aria-hidden
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{f.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{folderMeta(f)}</span>
                    </span>
                    <span className="flex shrink-0 items-center">
                      <IconButton label={`${f.name} 앞으로`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                        <HugeiconsIcon icon={ArrowUp01Icon} size={14} aria-hidden />
                      </IconButton>
                      <IconButton label={`${f.name} 뒤로`} disabled={busy || i === items.length - 1} onClick={() => move(i, 1)}>
                        <HugeiconsIcon icon={ArrowDown01Icon} size={14} aria-hidden />
                      </IconButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`${f.name} 폴더 메뉴`}
                              className="touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                            />
                          }
                        >
                          <HugeiconsIcon icon={MoreHorizontalIcon} size={15} aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          {!f.rule && (
                            <DropdownMenuItem className="touch-target" onClick={() => onPick(f.id)}>
                              <HugeiconsIcon icon={Add01Icon} size={14} aria-hidden />방 넣고 빼기
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="touch-target" onClick={() => setRenaming({ id: f.id, name: f.name })}>
                            <HugeiconsIcon icon={PencilEdit01Icon} size={14} aria-hidden />
                            이름 바꾸기
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" className="touch-target" onClick={() => setConfirmDelete(f.id)}>
                            <HugeiconsIcon icon={Delete02Icon} size={14} aria-hidden />
                            지우기
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-3 flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <Input
            value={newName}
            maxLength={FOLDER_NAME_MAX}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 폴더 이름"
            aria-label="새 폴더 이름"
            className="touch-target h-8 min-w-0 flex-1 text-[12.5px]"
          />
          <Button type="submit" size="sm" className="touch-target gap-1" disabled={busy || !newName.trim()}>
            <HugeiconsIcon icon={Add01Icon} size={14} aria-hidden />
            폴더 만들기
          </Button>
        </form>

        <h3 className="mt-5 mb-1.5 text-[11px] font-semibold text-muted-foreground">추천 폴더 · 자동으로 채워져요</h3>
        <ul className="flex flex-col divide-y rounded-lg border">
          <li className="flex min-w-0 items-center gap-2 px-2.5 py-2">
            <HugeiconsIcon icon={RULE_ICON.MY_TASKS} size={15} aria-hidden className="shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium">{RULE_FOLDER_INFO.MY_TASKS.name}</span>
              <span className="block text-[11px] text-muted-foreground">{RULE_FOLDER_INFO.MY_TASKS.hint}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              className="touch-target shrink-0 gap-1"
              disabled={busy || hasMyTasks}
              aria-label={hasMyTasks ? "내 업무 추가됨" : "내 업무 추가"}
              onClick={async () => {
                const f = await run(() => chatPrefs.createFolder({ rule: "MY_TASKS" }), "추천 폴더를 추가하지 못했습니다")
                if (f) onCreated(f.id)
              }}
            >
              {hasMyTasks && <HugeiconsIcon icon={Tick02Icon} size={13} aria-hidden />}
              {hasMyTasks ? "추가됨" : "추가"}
            </Button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => onPick("projects")}
              className="touch-target flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <HugeiconsIcon icon={RULE_ICON.PROJECT} size={15} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">프로젝트 폴더 추가</span>
                <span className="block text-[11px] text-muted-foreground">{RULE_FOLDER_INFO.PROJECT.hint}</span>
              </span>
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden className="shrink-0 text-muted-foreground" />
            </button>
          </li>
        </ul>
      </div>
    </>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="touch-target flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// ─── 방 고르기 ────────────────────────────────────────────

function RoomPicker({
  folder,
  rooms,
  onBack,
  onChanged,
}: {
  folder: ChatFolderView
  rooms: RoomListItem[]
  onBack: () => void
  onChanged: () => Promise<void>
}) {
  const [keys, setKeys] = useState(() => new Set(folder.roomKeys))
  const [q, setQ] = useState("")
  const shown = useMemo(() => filterRooms(sortByRecent(rooms), q), [rooms, q])

  const toggle = async (room: RoomListItem) => {
    const inside = keys.has(room.key)
    setKeys((s) => {
      const n = new Set(s)
      if (inside) n.delete(room.key)
      else n.add(room.key)
      return n
    })
    try {
      if (inside) await chatPrefs.removeFromFolder(folder.id, room.key)
      else await chatPrefs.addToFolder(folder.id, room.key)
    } catch (err) {
      toast.error(errText(err, "폴더를 바꾸지 못했습니다"))
      setKeys((s) => {
        const n = new Set(s)
        if (inside) n.add(room.key)
        else n.delete(room.key)
        return n
      })
    }
    await onChanged()
  }

  return (
    <>
      <DialogHeader className="border-b p-4 pr-12">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="폴더 목록으로"
            className="touch-target -ml-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden />
          </button>
          <DialogTitle className="min-w-0 truncate">「{folder.name}」 에 넣을 방</DialogTitle>
        </div>
        <DialogDescription className="text-[12px]">누르면 바로 넣고 빼요. 지금 {keys.size}개</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 px-4 pt-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="방 이름으로 찾기"
          aria-label="넣을 방 찾기"
          className="touch-target h-8 text-[12.5px]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {shown.length === 0 && <li className="px-3 py-2 text-[12px] text-muted-foreground">맞는 방이 없어요</li>}
        {shown.map((r) => {
          const on = keys.has(r.key)
          return (
            <li key={r.key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => void toggle(r)}
                className="touch-target flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded border",
                    on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                  )}
                >
                  {on && <HugeiconsIcon icon={Tick02Icon} size={11} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">
                    {r.kind === "TASK" && <span className="mr-0.5 text-muted-foreground">#</span>}
                    {r.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {r.kind === "OMNIS_DM" ? "옴니스" : r.kind === "COMPANY" ? "전사방" : r.kind === "TASK" ? "업무방" : "단톡방"}
                    {r.preview ? ` · ${r.preview}` : ""}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ─── 프로젝트 고르기 ──────────────────────────────────────

function ProjectPicker({
  folders,
  onBack,
  onChanged,
  onCreated,
}: {
  folders: ChatFolderView[]
  onBack: () => void
  onChanged: () => Promise<void>
  onCreated: (folderId: string) => void
}) {
  const [projects, setProjects] = useState<{ id: string; name: string; status: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      setProjects(await chatPrefs.projects())
    } catch (err) {
      setError(errText(err, "프로젝트를 불러오지 못했습니다"))
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const taken = new Set(folders.flatMap((f) => (f.rule === "PROJECT" && f.projectId ? [f.projectId] : [])))
  const needle = normalizeQuery(q)
  const shown = (projects ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle))

  const add = async (projectId: string) => {
    setBusy(projectId)
    try {
      const f = await chatPrefs.createFolder({ rule: "PROJECT", projectId })
      await onChanged()
      onCreated(f.id)
    } catch (err) {
      toast.error(errText(err, "프로젝트 폴더를 만들지 못했습니다"))
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <DialogHeader className="border-b p-4 pr-12">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="폴더 목록으로"
            className="touch-target -ml-1.5 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden />
          </button>
          <DialogTitle>프로젝트 폴더 추가</DialogTitle>
        </div>
        <DialogDescription className="text-[12px]">
          고른 프로젝트의 업무방이 저절로 모여요. 폴더 이름은 프로젝트 이름으로 시작하고 나중에 바꿀 수 있어요.
        </DialogDescription>
      </DialogHeader>
      <div className="shrink-0 px-4 pt-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="프로젝트 이름으로 찾기"
          aria-label="프로젝트 찾기"
          className="touch-target h-8 text-[12.5px]"
        />
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {error && (
          <li role="alert" className="m-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[12.5px]">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="touch-target mt-2" onClick={() => void load()}>
              다시 불러오기
            </Button>
          </li>
        )}
        {!projects && !error && <li className="px-3 py-2 text-[12px] text-muted-foreground">프로젝트를 불러오는 중…</li>}
        {projects && shown.length === 0 && (
          <li className="px-3 py-2 text-[12px] text-muted-foreground">
            {projects.length ? "맞는 프로젝트가 없어요" : "진행 중인 프로젝트가 없어요"}
          </li>
        )}
        {shown.map((p) => {
          const added = taken.has(p.id)
          return (
            <li key={p.id} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5">
              <HugeiconsIcon icon={Briefcase01Icon} size={14} aria-hidden className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{p.name}</span>
                <span className="block text-[11px] text-muted-foreground">{p.status}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                className="touch-target shrink-0 gap-1"
                disabled={added || busy !== null}
                aria-label={added ? `${p.name} 추가됨` : `${p.name} 폴더 추가`}
                onClick={() => void add(p.id)}
              >
                {added && <HugeiconsIcon icon={Tick02Icon} size={13} aria-hidden />}
                {added ? "추가됨" : busy === p.id ? "추가 중…" : "추가"}
              </Button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
