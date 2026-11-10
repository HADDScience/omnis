"use client"

// 사진 뷰어 — 카톡 뷰어처럼 어두운 전체 화면. 채팅(chat-photo-viewer.tsx)과 옴니스 사진 묶음(photo-album.tsx)이 같이 쓴다.
// 가운데 사진은 큰 폭 미리보기(WebP 960)를 먼저 그리고 원본이 오면 바꾼다. 썸네일 줄은 작은 미리보기.
// 계산(넘기기 · 닫기 판정, 확대 범위, 표기)은 lib/photo-viewer.ts
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Delete02Icon,
  Download04Icon,
  GridViewIcon,
  Image01Icon,
  MoreHorizontalIcon,
  Share08Icon,
} from "@hugeicons/core-free-icons"
import { ThumbImage } from "@/components/chat/thumb-image"
import { thumbUrl } from "@/lib/thumb"
import {
  clampPan,
  clampScale,
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SCALE,
  dragAxis,
  positionLabel,
  releaseOutcome,
  viewerTime,
  type ViewerPhoto,
} from "@/lib/photo-viewer"

export interface PhotoViewerProps {
  photos: ViewerPhoto[]
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
  /** 위 가운데 이름 · 시각을 누르면 그 글로 */
  onGoToMessage?: (messageId: string) => void
  /** 오른쪽 위 격자 — 그 방의 사진 모아보기 */
  onOpenGallery?: () => void
  /** 지우기 — 확인한 뒤 부른다. 사진이 든 글을 지운다 */
  onDelete?: (photo: ViewerPhoto) => Promise<void>
  /** 공유할 앱 안 주소. 없으면 공유 단추를 그리지 않는다 */
  shareUrl?: (photo: ViewerPhoto) => string
  /** 글이 없는 사진(옴니스 묶음)일 때 위 가운데에 쓸 제목 */
  title?: (photo: ViewerPhoto) => string
}

const ROUND = "touch-target inline-flex size-[44px] shrink-0 items-center justify-center rounded-full bg-white/12 text-white backdrop-blur hover:bg-white/20 disabled:opacity-40"

export function PhotoViewer(props: PhotoViewerProps) {
  const { photos, index } = props
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || index === null || !photos[index]) return null
  return createPortal(<ViewerBody {...props} index={index} />, document.body)
}

function ViewerBody({ photos, index, onIndex, onClose, onGoToMessage, onOpenGallery, onDelete, shareUrl, title }: PhotoViewerProps & { index: number }) {
  const photo = photos[index]
  const count = photos.length
  const root = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [chrome, setChrome] = useState(true)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [menu, setMenu] = useState<null | "more" | "delete">(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const go = useCallback((d: number) => {
    const next = index + d
    if (next >= 0 && next < count) onIndex(next)
  }, [index, count, onIndex])

  // 사진을 바꾸면 확대 · 이동을 처음으로
  useEffect(() => {
    setScale(1)
    setPan({ x: 0, y: 0 })
    setDrag({ x: 0, y: 0 })
    setMenu(null)
  }, [photo.fileId])

  // 열려 있는 동안 뒤 화면이 굴러가지 않게 · 키보드
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    root.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        if (menu) setMenu(null)
        else onClose()
      } else if (e.key === "ArrowLeft") go(-1)
      else if (e.key === "ArrowRight") go(1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, onClose, menu])

  // ─── 손가락 · 마우스 ───────────────────────────────────────
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{
    x: number; y: number; t: number; pan: { x: number; y: number }
    axis: "x" | "y" | null; moved: boolean
    pinch?: { dist: number; scale: number }
  } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current) }, [])

  const boxes = () => {
    const view = stage.current!
    const img = imgRef.current
    return { view: { w: view.clientWidth, h: view.clientHeight }, img: { w: img?.clientWidth ?? 0, h: img?.clientHeight ?? 0 } }
  }
  const distance = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return
    // 사진 위 단추(이전 · 다음)는 붙잡지 않는다 — 붙잡으면 click 이 단추에 가지 않는다
    if ((e.target as HTMLElement).closest("button, a")) return
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      gesture.current = { ...(gesture.current ?? { x: e.clientX, y: e.clientY, t: Date.now(), axis: null }), pan, moved: true, pinch: { dist: distance(), scale } }
      setDrag({ x: 0, y: 0 })
      setDragging(true)
    } else if (pointers.current.size === 1) {
      gesture.current = { x: e.clientX, y: e.clientY, t: Date.now(), pan, axis: null, moved: false }
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (g.pinch && pointers.current.size >= 2) {
      setScale(clampScale(g.pinch.scale * (distance() / g.pinch.dist)))
      return
    }
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (!g.moved && Math.hypot(dx, dy) > 10) g.moved = true
    if (!g.moved) return
    if (scale > 1) {
      const { view, img } = boxes()
      setDragging(true)
      setPan(clampPan(scale, g.pan.x + dx, g.pan.y + dy, view, img))
      return
    }
    g.axis ??= dragAxis(dx, dy)
    setDragging(true)
    if (g.axis === "x") setDrag({ x: dx, y: 0 })
    else if (g.axis === "y") setDrag({ x: 0, y: Math.max(0, dy) })
  }

  function onPointerUp(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.delete(e.pointerId)
    const g = gesture.current
    if (!g) return
    if (g.pinch) {
      // 두 손가락을 다 떼면 끝 — 거의 1배면 1배로 되돌린다
      if (pointers.current.size === 0) {
        gesture.current = null
        setDragging(false)
        if (scale < 1.05) {
          setScale(1)
          setPan({ x: 0, y: 0 })
        }
      }
      return
    }
    gesture.current = null
    setDragging(false)
    if (!g.moved) return tap(e.clientX, e.clientY)
    if (scale > 1) return
    const outcome = releaseOutcome({ dx: e.clientX - g.x, dy: e.clientY - g.y, ms: Date.now() - g.t, width: stage.current?.clientWidth ?? 1, count, index })
    setDrag({ x: 0, y: 0 })
    if (outcome === "next") go(1)
    else if (outcome === "prev") go(-1)
    else if (outcome === "close") onClose()
  }

  function onPointerCancel(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId)
    gesture.current = null
    setDragging(false)
    setDrag({ x: 0, y: 0 })
  }

  /** 한 번 탭은 위아래 단추를 숨기고 보이고, 두 번 탭은 그 자리를 확대 · 되돌림 */
  function tap(x: number, y: number) {
    const now = Date.now()
    const prev = lastTap.current
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) < 30) {
      lastTap.current = null
      if (tapTimer.current) clearTimeout(tapTimer.current)
      if (scale > 1) {
        setScale(1)
        setPan({ x: 0, y: 0 })
      } else {
        const rect = stage.current!.getBoundingClientRect()
        const { view, img } = boxes()
        const cx = x - rect.left - rect.width / 2
        const cy = y - rect.top - rect.height / 2
        setScale(DOUBLE_TAP_SCALE)
        setPan(clampPan(DOUBLE_TAP_SCALE, -cx * (DOUBLE_TAP_SCALE - 1), -cy * (DOUBLE_TAP_SCALE - 1), view, img))
      }
      return
    }
    lastTap.current = { t: now, x, y }
    if (tapTimer.current) clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => setChrome((c) => !c), DOUBLE_TAP_MS)
  }

  // PC 트랙패드 두 손가락 확대(ctrl + 휠)
  function onWheel(e: React.WheelEvent) {
    if (!e.ctrlKey) return
    const next = clampScale(scale * Math.exp(-e.deltaY / 200))
    setScale(next)
    if (next === 1) setPan({ x: 0, y: 0 })
  }

  // ─── 단추 ────────────────────────────────────────────────
  async function share() {
    if (!shareUrl) return
    const url = new URL(shareUrl(photo), window.location.href).toString()
    try {
      if (navigator.share) {
        await navigator.share({ title: photo.name, url })
        return
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return
    }
    try {
      await navigator.clipboard.writeText(url)
      setNotice("링크를 복사했습니다")
    } catch {
      setNotice("링크를 복사하지 못했습니다")
    }
  }
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 2000)
    return () => clearTimeout(t)
  }, [notice])

  async function remove() {
    if (!onDelete) return
    setBusy(true)
    try {
      await onDelete(photo)
    } catch {
      setNotice("지우지 못했습니다")
    } finally {
      setBusy(false)
      setMenu(null)
    }
  }

  const fade = Math.min(1, drag.y / 400)
  const chromeClass = `transition-opacity duration-200 ${chrome && drag.y === 0 ? "opacity-100" : "pointer-events-none opacity-0"}`
  const heading = photo.authorName ?? title?.(photo) ?? photo.name
  const canDelete = !!onDelete && !!photo.canDelete && !!photo.messageId

  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label="사진 보기"
      tabIndex={-1}
      data-photo-viewer
      className="fixed inset-0 z-50 flex flex-col text-white outline-none select-none"
      style={{ backgroundColor: `rgba(20,20,20,${1 - fade * 0.8})` }}
    >
      {/* 위 — 뒤로 · 보낸 사람과 시각 · 모아보기 */}
      <div className={`absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-3 pt-[max(env(safe-area-inset-top),12px)] pb-6 ${chromeClass}`}>
        <button type="button" onClick={onClose} aria-label="닫기" className={ROUND}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={22} aria-hidden />
        </button>
        {photo.messageId && onGoToMessage ? (
          <button
            type="button"
            onClick={() => onGoToMessage(photo.messageId!)}
            aria-label={`${heading}${photo.createdAt ? ` ${viewerTime(photo.createdAt)}` : ""} 글로 이동`}
            className="touch-target flex min-w-0 flex-1 flex-col items-start rounded-lg px-1 text-left"
          >
            <span className="w-full truncate text-[16px] font-semibold leading-5">{heading}</span>
            {photo.createdAt && (
              <span className="flex items-center text-[13px] leading-5 text-white/75">
                {viewerTime(photo.createdAt)}
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} aria-hidden />
              </span>
            )}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate px-1 text-[15px] font-semibold">{heading}</span>
        )}
        {onOpenGallery && (
          <button type="button" onClick={onOpenGallery} aria-label="이 방 사진 모아보기" className={ROUND}>
            <HugeiconsIcon icon={GridViewIcon} size={20} aria-hidden />
          </button>
        )}
      </div>

      {/* 가운데 — 사진 */}
      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onWheel={onWheel}
      >
        <StageImage
          key={photo.fileId}
          photo={photo}
          imgRef={imgRef}
          style={{
            transform: `translate3d(${pan.x + drag.x}px, ${pan.y + drag.y}px, 0) scale(${scale * (1 - fade * 0.2)})`,
            transition: dragging ? "none" : "transform 180ms ease-out",
          }}
        />
        {count > 1 && (
          <>
            {/* 마우스로 보는 화면에서만 — 폰은 밀어 넘긴다 */}
            <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="이전 사진" className={`${ROUND} absolute left-3 pointer-coarse:hidden ${chromeClass}`}>
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} aria-hidden />
            </button>
            <button type="button" onClick={() => go(1)} disabled={index === count - 1} aria-label="다음 사진" className={`${ROUND} absolute right-3 pointer-coarse:hidden ${chromeClass}`}>
              <HugeiconsIcon icon={ArrowRight01Icon} size={20} aria-hidden />
            </button>
          </>
        )}
      </div>

      {/* 아래 — 썸네일 줄 · 위치 · 단추 */}
      <div className={`absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 bg-gradient-to-t from-black/60 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),12px)] ${chromeClass}`}>
        {count > 1 && (
          <>
            <div role="group" aria-label="같은 글의 사진" className="flex max-w-full gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
              {photos.map((p, i) => (
                <button
                  key={p.fileId}
                  type="button"
                  onClick={() => onIndex(i)}
                  aria-label={`${i + 1}번째 사진`}
                  aria-current={i === index ? "true" : undefined}
                  className={`relative size-[44px] shrink-0 overflow-hidden rounded-md border-2 ${i === index ? "border-yellow-300" : "border-transparent opacity-70"}`}
                >
                  <ThumbImage fileId={p.fileId} original={p.original} cssWidth={44} className="size-full object-cover" draggable={false} />
                </button>
              ))}
            </div>
            <p aria-live="polite" className="flex items-center gap-1.5 text-[13px] text-white/90">
              <HugeiconsIcon icon={Image01Icon} size={16} aria-hidden />
              {positionLabel(index, count)}
            </p>
          </>
        )}
        <div className="flex w-full max-w-md items-center justify-between gap-3">
          <a href={photo.original} download={photo.name} aria-label="내려받기" className={ROUND}>
            <HugeiconsIcon icon={Download04Icon} size={20} aria-hidden />
          </a>
          <div className="flex h-[44px] items-center gap-1 rounded-full bg-white/12 px-1.5 backdrop-blur">
            {canDelete && (
              <button type="button" onClick={() => setMenu("delete")} aria-label="삭제" className="touch-target inline-flex size-[44px] items-center justify-center rounded-full hover:bg-white/15">
                <HugeiconsIcon icon={Delete02Icon} size={20} aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="더보기" aria-expanded={menu === "more"} className="touch-target inline-flex size-[44px] items-center justify-center rounded-full hover:bg-white/15">
              <HugeiconsIcon icon={MoreHorizontalIcon} size={20} aria-hidden />
            </button>
          </div>
          {shareUrl ? (
            <button type="button" onClick={() => void share()} aria-label="공유" className={ROUND}>
              <HugeiconsIcon icon={Share08Icon} size={20} aria-hidden />
            </button>
          ) : (
            <span className="size-[44px]" aria-hidden />
          )}
        </div>
      </div>

      {/* 더보기 · 지우기 확인 — 뷰어 안에서 연다(바깥 팝업은 뷰어 뒤로 깔릴 수 있다) */}
      {menu && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40 p-4 pb-[max(env(safe-area-inset-bottom),16px)]" onClick={() => setMenu(null)}>
          <div role={menu === "delete" ? "alertdialog" : "menu"} aria-label={menu === "delete" ? "사진 지우기" : "더보기"} className="w-full max-w-sm overflow-hidden rounded-2xl bg-neutral-800 text-[15px]" onClick={(e) => e.stopPropagation()}>
            {menu === "more" ? (
              <>
                <a role="menuitem" href={photo.original} target="_blank" rel="noreferrer" className="touch-target flex h-12 items-center px-4 hover:bg-white/10" onClick={() => setMenu(null)}>
                  원본 열기
                </a>
                {photo.messageId && onGoToMessage && (
                  <button role="menuitem" type="button" className="touch-target flex h-12 w-full items-center border-t border-white/10 px-4 text-left hover:bg-white/10" onClick={() => onGoToMessage(photo.messageId!)}>
                    글로 이동
                  </button>
                )}
              </>
            ) : (
              <>
                <p className="px-4 pt-4 pb-1 font-semibold">이 사진이 있는 글을 지울까요?</p>
                <p className="px-4 pb-3 text-[13px] text-white/70">{count > 1 ? `같은 글의 사진 ${count}장이 함께 지워집니다.` : "글과 사진이 함께 지워집니다."}</p>
                <div className="flex border-t border-white/10">
                  <button type="button" className="touch-target h-12 flex-1 hover:bg-white/10" onClick={() => setMenu(null)}>
                    취소
                  </button>
                  <button type="button" disabled={busy} className="touch-target h-12 flex-1 border-l border-white/10 font-semibold text-red-400 hover:bg-white/10" onClick={() => void remove()}>
                    {busy ? "지우는 중…" : "지우기"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {notice && (
        <p role="status" className="absolute inset-x-0 top-1/2 z-30 mx-auto w-fit rounded-full bg-black/80 px-4 py-2 text-[14px]">
          {notice}
        </p>
      )}
    </div>
  )
}

/** 큰 폭 미리보기(WebP 960)를 먼저 그리고, 원본을 다 받으면 바꾼다. 미리보기가 안 되면 처음부터 원본 */
function StageImage({ photo, imgRef, style }: { photo: ViewerPhoto; imgRef: React.RefObject<HTMLImageElement | null>; style: React.CSSProperties }) {
  const [src, setSrc] = useState(() => thumbUrl(photo.fileId, 960))
  useEffect(() => {
    const full = new Image()
    full.onload = () => setSrc(photo.original)
    full.src = photo.original
    return () => {
      full.onload = null
    }
  }, [photo.original])
  return (
    // eslint-disable-next-line @next/next/no-img-element -- 인증이 필요한 첨부 라우트
    <img
      ref={imgRef}
      src={src}
      alt={photo.name}
      data-viewer-src={src === photo.original ? "original" : "preview"}
      draggable={false}
      onError={() => setSrc((s) => (s === photo.original ? s : photo.original))}
      className="max-h-full max-w-full object-contain will-change-transform"
      style={style}
    />
  )
}
