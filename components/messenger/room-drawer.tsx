"use client"

// 방 서랍 — 방 머리 오른쪽 ≡ 에서 연다. PC 는 오른쪽에서 밀려 나오는 칸, 폰은 전체 시트.
// 탭: 사진(격자 · 최신순 · 누르면 뷰어) / 파일 / 링크 / 참여자. 사진 · 파일은 기간 · 종류 필터, 다중 선택, 「N개 받기 · 총 크기」.
// 받기는 브라우저에서 묶는다(lib/room-download/client.ts). 1GB 를 넘으면 나눠 받기 단추로 묶음을 고른다.
// 예전 사진 모아보기(components/photo-viewer/room-photo-grid.tsx)는 서랍이 없는 화면(업무 스레드)에서만 남는다.
import { useCallback, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Doc01Icon,
  File01Icon,
  LinkSquare02Icon,
  MusicNote01Icon,
  Pdf01Icon,
  Ppt01Icon,
  Video01Icon,
  Xls01Icon,
  ZipIcon,
} from "@hugeicons/core-free-icons"
import { ThumbImage } from "@/components/chat/thumb-image"
import { AuthorAvatar } from "@/components/chat/message-parts"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import {
  DOWNLOAD_BATCH_BYTES,
  DRAWER_PERIODS,
  DRAWER_TABS,
  FILE_KINDS,
  PHOTO_KINDS,
  fileCategory,
  formatBytes,
  seoulDate,
  splitBatches,
  totalBytes,
  type DrawerKind,
  type DrawerPeriod,
  type DrawerTab,
  type MissingItem,
} from "@/lib/room-drawer"
import type { DrawerFile, DrawerLink, DrawerMember } from "@/lib/room-drawer-server"
import { startRoomDownload } from "@/lib/room-download/client"
import { isViewerImage } from "@/lib/photo-viewer"

const PILL = "touch-target inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3.5 text-[13.5px] transition-colors"
const pillTone = (on: boolean) => (on ? "bg-foreground text-background" : "bg-foreground/[0.06] text-foreground hover:bg-foreground/10")

const KIND_ICON: Record<string, { icon: typeof File01Icon; tone: string }> = {
  pdf: { icon: Pdf01Icon, tone: "text-red-600 bg-red-50 dark:bg-red-950/40 dark:text-red-300" },
  slide: { icon: Ppt01Icon, tone: "text-orange-600 bg-orange-50 dark:bg-orange-950/40 dark:text-orange-300" },
  sheet: { icon: Xls01Icon, tone: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300" },
  doc: { icon: Doc01Icon, tone: "text-sky-700 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300" },
  archive: { icon: ZipIcon, tone: "text-violet-700 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300" },
  video: { icon: Video01Icon, tone: "text-fuchsia-700 bg-fuchsia-50 dark:bg-fuchsia-950/40 dark:text-fuchsia-300" },
  audio: { icon: MusicNote01Icon, tone: "text-amber-700 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300" },
  other: { icon: File01Icon, tone: "text-muted-foreground bg-muted" },
}

const shortDate = (iso: string) => {
  const d = seoulDate(iso)
  return d.slice(0, 4) === seoulDate(new Date()).slice(0, 4) ? `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : d.replaceAll("-", ".")
}

/** 원본 없는 자리표시 중 지금 종류 필터에 드는 것 */
function missingFor(tab: "photos" | "files", kind: DrawerKind, missing: MissingItem[]): MissingItem[] {
  if (kind === "all") return missing
  if (tab === "photos") return kind === "photo" ? missing : []
  return missing.filter((m) => (m.kind === "video" ? kind === "video" : fileCategory({ name: m.label, mimeType: "" }) === kind))
}

export interface RoomDrawerProps {
  roomId: string
  roomName: string
  open: boolean
  tab: DrawerTab
  onTab: (tab: DrawerTab) => void
  onClose: () => void
  /** 사진을 누르면 뷰어로 — 같은 글의 사진끼리 넘긴다 */
  onPickPhoto?: (photo: DrawerFile, all: DrawerFile[]) => void
  /** 링크 · 파일의 「글로 가기」 */
  onGoToMessage?: (messageId: string) => void
}

export function RoomDrawer(props: RoomDrawerProps) {
  const { open, onClose } = props
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      // 뷰어가 위에 떠 있으면 뷰어가 먼저 닫힌다
      if (e.key === "Escape" && !document.querySelector("[data-photo-viewer]")) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-[47] hidden bg-black/20 backdrop-blur-[2px] md:block" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${props.roomName} 서랍`}
        data-room-drawer
        className={cn(
          // 위는 데모 띠(있으면) 아래에서 시작한다
          "fixed inset-x-0 top-[var(--demo-banner-height,0px)] bottom-0 z-[48] flex flex-col bg-background text-foreground",
          "md:top-[calc(var(--demo-banner-height,0px)+12px)] md:right-3 md:bottom-3 md:left-auto md:w-[440px] md:overflow-hidden md:rounded-[28px] md:border md:border-foreground/10 md:bg-background/80 md:shadow-2xl md:backdrop-blur-2xl md:backdrop-saturate-150",
          "animate-in slide-in-from-right-8 fade-in duration-200 motion-reduce:animate-none",
        )}
      >
        <DrawerBody {...props} />
      </div>
    </>
  )
}

function DrawerBody({ roomId, roomName, tab, onTab, onClose, onPickPhoto, onGoToMessage }: RoomDrawerProps) {
  const [period, setPeriod] = useState<DrawerPeriod>("all")
  const [kind, setKind] = useState<DrawerKind>("all")
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])

  // 탭 · 필터를 바꾸면 고른 것을 비운다 — 안 보이는 파일이 받기에 섞이지 않게
  const resetSelection = () => setSelected([])
  const switchTab = (t: DrawerTab) => {
    onTab(t)
    setKind("all")
    resetSelection()
    setSelecting(false)
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-[max(var(--safe-top,0px),14px)] pb-2 md:pt-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-muted-foreground">서랍</p>
          <h2 className="truncate text-[18px] leading-tight font-semibold">{roomName}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="서랍 닫기" className="touch-target glass inline-flex size-[44px] shrink-0 items-center justify-center rounded-full">
          <HugeiconsIcon icon={Cancel01Icon} size={18} aria-hidden />
        </button>
      </div>
      <div role="tablist" aria-label="서랍 탭" className="glass mx-4 flex gap-1 rounded-full p-1">
        {DRAWER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => switchTab(t.id)}
            className={cn("touch-target h-9 flex-1 rounded-full text-[14px] font-medium transition-colors", tab === t.id ? "bg-background text-foreground shadow-sm dark:bg-foreground/15" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(tab === "photos" || tab === "links" || tab === "files") && (
        <div className="mt-3 flex flex-col gap-2 px-4">
          <div className="flex items-center gap-1.5">
            {DRAWER_PERIODS.map((p) => (
              <button key={p.id} type="button" aria-pressed={period === p.id} onClick={() => { setPeriod(p.id); resetSelection() }} className={cn(PILL, pillTone(period === p.id))}>
                {p.label}
              </button>
            ))}
            {tab !== "links" && (
              <button
                type="button"
                aria-pressed={selecting}
                onClick={() => { setSelecting((v) => !v); resetSelection() }}
                className={cn(PILL, "ml-auto", selecting ? "bg-primary text-primary-foreground" : "bg-foreground/[0.06] hover:bg-foreground/10")}
              >
                {selecting ? "선택 끝" : "선택"}
              </button>
            )}
          </div>
          {tab !== "links" && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" aria-label="종류">
              {(tab === "photos" ? PHOTO_KINDS : FILE_KINDS).map((k) => (
                <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => { setKind(k.id); resetSelection() }} className={cn(PILL, "h-8 px-3 text-[13px]", pillTone(kind === k.id))}>
                  {k.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="relative mt-2 min-h-0 flex-1">
        {(tab === "photos" || tab === "files") && (
          <FilesTab
            key={`${tab}:${period}:${kind}`}
            roomId={roomId}
            roomName={roomName}
            tab={tab}
            period={period}
            kind={kind}
            selecting={selecting}
            selected={selected}
            setSelected={setSelected}
            onPickPhoto={onPickPhoto}
            onGoToMessage={onGoToMessage}
          />
        )}
        {tab === "links" && <LinksTab key={period} roomId={roomId} period={period} onGoToMessage={onGoToMessage} />}
        {tab === "members" && <MembersTab roomId={roomId} />}
      </div>
    </>
  )
}

function useDrawerPages<T>(roomId: string, query: Record<string, string>, pick: (body: unknown) => T[]) {
  const [items, setItems] = useState<T[]>([])
  const [extra, setExtra] = useState<unknown>(null)
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const key = JSON.stringify(query)
  const load = useCallback(
    async (before: string | null) => {
      setLoading(true)
      setError(false)
      try {
        const params = new URLSearchParams({ roomId, ...JSON.parse(key), ...(before ? { before } : {}) })
        const res = await fetch(apiUrl(`/api/chat/drawer?${params}`), { cache: "no-store" })
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as { nextBefore?: string | null }
        setItems((prev) => (before ? [...prev, ...pick(body)] : pick(body)))
        if (!before) setExtra(body)
        setNext(body.nextBefore ?? null)
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    // pick 은 매번 새 함수지만 하는 일이 같다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomId, key],
  )
  useEffect(() => void load(null), [load])
  return { items, extra, next, loading, error, more: () => next && void load(next) }
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-6 py-10 text-center text-[14px] text-muted-foreground">{children}</p>
}

function MoreButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn(PILL, "mx-auto my-4 flex bg-foreground/[0.06] hover:bg-foreground/10")}>
      더 보기
    </button>
  )
}

function FilesTab({
  roomId,
  roomName,
  tab,
  period,
  kind,
  selecting,
  selected,
  setSelected,
  onPickPhoto,
  onGoToMessage,
}: {
  roomId: string
  roomName: string
  tab: "photos" | "files"
  period: DrawerPeriod
  kind: DrawerKind
  selecting: boolean
  selected: string[]
  setSelected: (fn: (prev: string[]) => string[]) => void
  onPickPhoto?: RoomDrawerProps["onPickPhoto"]
  onGoToMessage?: RoomDrawerProps["onGoToMessage"]
}) {
  const { items, extra, next, loading, error, more } = useDrawerPages<DrawerFile>(roomId, { tab, period, kind }, (b) => (b as { files: DrawerFile[] }).files)
  const missing = useMemo(() => missingFor(tab, kind, ((extra as { missing?: MissingItem[] } | null)?.missing ?? []) as MissingItem[]), [extra, tab, kind])
  const [showMissing, setShowMissing] = useState(false)
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  const chosen = useMemo(() => items.filter((f) => selected.includes(f.fileId)), [items, selected])

  return (
    <div className="flex h-full flex-col">
      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-[max(var(--safe-bottom,0px),16px)]", selecting && "pb-[calc(var(--safe-bottom,0px)+150px)]")}>
        {missing.length > 0 && (
          <div className="mx-4 mb-2 rounded-2xl bg-foreground/[0.04] px-3.5 py-2.5 text-[13px]">
            <button type="button" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing} className="flex w-full items-center gap-2 text-left text-muted-foreground" data-drawer-missing>
              <span className="min-w-0 flex-1">카톡 원본에만 있는 {missing.length}개 — 옴니스에 파일이 없어요</span>
              <span className="shrink-0 underline underline-offset-2">{showMissing ? "접기" : "보기"}</span>
            </button>
            {showMissing && (
              <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
                {missing.slice(0, 100).map((m) => (
                  <li key={m.messageId} className="flex gap-2">
                    <span className="shrink-0 tabular-nums">{shortDate(m.createdAt)}</span>
                    <span className="shrink-0">{m.authorName}</span>
                    <span className="min-w-0 truncate">{m.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tab === "photos" ? (
          <ul className="grid grid-cols-3 gap-0.5 px-0.5 md:px-4 md:gap-1">
            {items.map((p) => {
              const on = selected.includes(p.fileId)
              const viewable = isViewerImage(p)
              return (
                <li key={p.fileId}>
                  <button
                    type="button"
                    data-drawer-photo
                    aria-pressed={selecting ? on : undefined}
                    onClick={() => (selecting ? toggle(p.fileId) : viewable && onPickPhoto ? onPickPhoto(p, items) : window.open(apiUrl(`/api/files/${p.fileId}/raw`), "_blank", "noopener"))}
                    aria-label={`${p.author.name}의 사진 ${p.name}`}
                    className="relative block aspect-square w-full overflow-hidden bg-foreground/5 md:rounded-xl"
                  >
                    {viewable ? (
                      <ThumbImage fileId={p.fileId} original={apiUrl(`/api/files/${p.fileId}/raw`)} cssWidth={140} loading="lazy" className={cn("size-full object-cover transition-transform", on && "scale-90 rounded-lg")} />
                    ) : (
                      <span className="flex size-full items-center justify-center p-2 text-center text-[12px] break-all text-muted-foreground">{p.name}</span>
                    )}
                    {selecting && (
                      <span aria-hidden className={cn("absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-white shadow", on ? "bg-primary text-primary-foreground" : "bg-black/25")}>
                        {on && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="flex flex-col px-2">
            {items.map((f) => {
              const on = selected.includes(f.fileId)
              const k = KIND_ICON[fileCategory(f)] ?? KIND_ICON.other
              const row = (
                <>
                  {selecting && (
                    <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border-2", on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/25")}>
                      {on && <HugeiconsIcon icon={CheckmarkCircle02Icon} size={16} />}
                    </span>
                  )}
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", k.tone)}>
                    <HugeiconsIcon icon={k.icon} size={19} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium">{f.name}</span>
                    <span className="block truncate text-[12.5px] text-muted-foreground tabular-nums">
                      {formatBytes(f.size)} · {f.author.name} · {shortDate(f.createdAt)}
                    </span>
                  </span>
                </>
              )
              return (
                <li key={f.fileId} className="flex items-center">
                  {selecting ? (
                    <button type="button" data-drawer-file aria-pressed={on} onClick={() => toggle(f.fileId)} className="touch-target flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-foreground/[0.04]">
                      {row}
                    </button>
                  ) : (
                    <a data-drawer-file href={apiUrl(`/api/files/${f.fileId}/raw`)} target="_blank" rel="noopener noreferrer" className="touch-target flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 hover:bg-foreground/[0.04]">
                      {row}
                    </a>
                  )}
                  {!selecting && onGoToMessage && (
                    <button type="button" onClick={() => onGoToMessage(f.messageId)} className="touch-target shrink-0 rounded-full px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-foreground/[0.06]" aria-label={`${f.name} 글로 가기`}>
                      글로
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {loading && <Spinner className="mx-auto my-6 size-5" />}
        {!loading && error && <Empty>불러오지 못했습니다</Empty>}
        {!loading && !error && items.length === 0 && <Empty>{tab === "photos" ? "이 기간에 사진이 없습니다" : "이 기간에 파일이 없습니다"}</Empty>}
        {!loading && next && <MoreButton onClick={more} />}
      </div>
      {selecting && (
        <DownloadBar
          roomId={roomId}
          roomName={roomName}
          chosen={chosen}
          loadedCount={items.length}
          missing={missing}
          onSelectAll={() => setSelected(() => (chosen.length === items.length ? [] : items.map((f) => f.fileId)))}
        />
      )}
    </div>
  )
}

function DownloadBar({
  roomId,
  roomName,
  chosen,
  loadedCount,
  missing,
  onSelectAll,
}: {
  roomId: string
  roomName: string
  chosen: DrawerFile[]
  loadedCount: number
  missing: MissingItem[]
  onSelectAll: () => void
}) {
  const sum = totalBytes(chosen)
  const batches = useMemo(() => splitBatches(chosen), [chosen])
  const go = (files: DrawerFile[], index: number, count: number) =>
    void startRoomDownload({ roomId, roomName, fileIds: files.map((f) => f.fileId), missing: index === 0 ? missing : undefined, part: { index, count } })
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 px-4 pt-6 pb-[max(var(--safe-bottom,0px),14px)] [background:linear-gradient(to_top,var(--background)_55%,transparent)]" data-drawer-download-bar>
      {missing.length > 0 && chosen.length > 0 && (
        <p className="pointer-events-auto text-center text-[12.5px] text-muted-foreground" data-drawer-missing-note>
          {missing.length}개는 원본 없음 — 받지 못하고 zip 에 빠진파일.txt 로 적어 둡니다
        </p>
      )}
      {batches.length > 1 && (
        <p className="pointer-events-auto text-center text-[12.5px] text-muted-foreground" data-drawer-split-note>
          {formatBytes(sum)} — {formatBytes(DOWNLOAD_BATCH_BYTES)} 를 넘어 {batches.length}묶음으로 나눠 받아요
        </p>
      )}
      <div className="pointer-events-auto flex items-center gap-2">
        <button type="button" onClick={onSelectAll} disabled={loadedCount === 0} className={cn(PILL, "glass h-12 px-4 text-[14px]")}>
          {chosen.length === loadedCount && loadedCount > 0 ? "선택 해제" : "모두 선택"}
        </button>
        {batches.length <= 1 ? (
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => go(chosen, 0, 1)}
            className="touch-target h-12 min-w-0 flex-1 rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground shadow-lg disabled:opacity-40"
            data-drawer-download
          >
            {chosen.length === 0 ? "받을 것을 고르세요" : `${chosen.length}개 받기 · ${formatBytes(sum)}`}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
            {batches.map((b, i) => (
              <button key={i} type="button" onClick={() => go(b, i, batches.length)} className="touch-target h-12 shrink-0 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground" data-drawer-download-part>
                {i + 1}/{batches.length} 받기 · {formatBytes(totalBytes(b))}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function LinksTab({ roomId, period, onGoToMessage }: { roomId: string; period: DrawerPeriod; onGoToMessage?: RoomDrawerProps["onGoToMessage"] }) {
  const { items, next, loading, error, more } = useDrawerPages<DrawerLink>(roomId, { tab: "links", period }, (b) => (b as { links: DrawerLink[] }).links)
  return (
    <div className="h-full overflow-y-auto pb-[max(var(--safe-bottom,0px),16px)]">
      <ul className="flex flex-col px-2">
        {items.map((l, i) => (
          <li key={`${l.messageId}:${i}`} className="flex items-center">
            <a data-drawer-link href={l.url} target="_blank" rel="noopener noreferrer" className="touch-target flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 hover:bg-foreground/[0.04]">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <HugeiconsIcon icon={LinkSquare02Icon} size={19} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-medium">{l.host}</span>
                <span className="block truncate text-[12.5px] text-muted-foreground">{l.url}</span>
                <span className="block truncate text-[12px] text-muted-foreground">{l.author.name} · {shortDate(l.createdAt)}</span>
              </span>
            </a>
            {onGoToMessage && (
              <button type="button" onClick={() => onGoToMessage(l.messageId)} className="touch-target shrink-0 rounded-full px-2.5 py-1.5 text-[12.5px] text-muted-foreground hover:bg-foreground/[0.06]" aria-label={`${l.host} 링크 글로 가기`}>
                글로
              </button>
            )}
          </li>
        ))}
      </ul>
      {loading && <Spinner className="mx-auto my-6 size-5" />}
      {!loading && error && <Empty>불러오지 못했습니다</Empty>}
      {!loading && !error && items.length === 0 && <Empty>이 기간에 링크가 없습니다</Empty>}
      {!loading && next && <MoreButton onClick={more} />}
    </div>
  )
}

function MembersTab({ roomId }: { roomId: string }) {
  const { items, loading, error } = useDrawerPages<DrawerMember>(roomId, { tab: "members" }, (b) => (b as { members: DrawerMember[] }).members)
  const people = items.filter((m) => !m.external)
  const outside = items.filter((m) => m.external)
  const row = (m: DrawerMember) => (
    <li key={m.id} className="flex items-center gap-3 rounded-2xl px-2 py-2" data-drawer-member>
      <AuthorAvatar name={m.name} size={40} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-medium">{m.name}</span>
        {m.position && <span className="block truncate text-[12.5px] text-muted-foreground">{m.position}</span>}
      </span>
    </li>
  )
  return (
    <div className="h-full overflow-y-auto px-2 pb-[max(var(--safe-bottom,0px),16px)]">
      {people.length > 0 && <p className="px-2 pt-1 pb-1 text-[12.5px] text-muted-foreground">참여자 {people.length}명</p>}
      <ul>{people.map(row)}</ul>
      {outside.length > 0 && (
        <>
          <p className="px-2 pt-3 pb-1 text-[12.5px] text-muted-foreground">카톡에서 옮긴 글에만 있는 사람 {outside.length}명 · 옴니스 계정 없음</p>
          <ul>{outside.map(row)}</ul>
        </>
      )}
      {loading && <Spinner className="mx-auto my-6 size-5" />}
      {!loading && error && <Empty>불러오지 못했습니다</Empty>}
    </div>
  )
}
