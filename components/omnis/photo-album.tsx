"use client"

// 옴니스 답의 사진 묶음 — 카톡 「묶어 보내기」처럼 정사각 격자 한 덩어리. 누르면 큰 화면에서 넘겨 본다.
// 묶을 사진 고르기 · 줄 나누기는 lib/photo-album.ts.
import { useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { apiUrl } from "@/lib/base-path"
import { ThumbImage } from "@/components/chat/thumb-image"
import { albumRows } from "@/lib/photo-album"

export interface AlbumPhoto {
  sourceId: string
  title: string
  /** 답의 각주 번호 */
  num: number
}

/** 묶음에 보이는 최대 장수. 넘치면 마지막 칸에 「+N」 — 누르면 뷰어에서 전부 넘겨 본다 */
const MAX_TILES = 9

export function PhotoAlbum({ photos }: { photos: AlbumPhoto[] }) {
  const [open, setOpen] = useState<number | null>(null)
  if (photos.length === 0) return null

  const tiles = photos.slice(0, MAX_TILES)
  const hidden = photos.length - tiles.length
  const sizes = albumRows(tiles.length)
  const rows = sizes.map((n, r) => {
    const start = sizes.slice(0, r).reduce((a, b) => a + b, 0)
    return tiles.slice(start, start + n).map((p, j) => ({ p, i: start + j }))
  })
  // 한 장이면 정사각으로 자르지 않고 그대로 — 카톡도 한 장은 원래 비율로 보인다
  const single = tiles.length === 1

  return (
    <>
      <div className="@container mt-3 flex max-w-[360px] flex-col gap-0.5 overflow-hidden rounded-xl" aria-label={`사진 ${photos.length}장`}>
        {rows.map((row, r) => (
          <div key={r} className="flex gap-0.5 @max-[140px]:flex-wrap">
            {row.map(({ p, i }) => (
              <button
                key={p.sourceId}
                type="button"
                onClick={() => setOpen(i)}
                className={`touch-target relative min-w-0 flex-1 bg-muted @max-[140px]:basis-[calc(50%-1px)] ${single ? "" : "aspect-square"}`}
                aria-label={`${p.title} 크게 보기`}
              >
                {/* WebP 미리보기 — 원본은 평균 1.4MB. 크게 보기 · 원본 열기만 원본 */}
                <ThumbImage
                  fileId={p.sourceId}
                  original={apiUrl(`/api/files/${p.sourceId}/raw`)}
                  cssWidth={single ? 360 : row.length === 1 ? 360 : row.length === 2 ? 180 : 120}
                  loading="lazy"
                  className={single ? "block max-h-[360px] w-full object-cover" : "absolute inset-0 h-full w-full object-cover"}
                />
                <span className="absolute top-1 left-1 rounded bg-black/55 px-1 font-mono text-[10px] leading-4 text-white">{p.num}</span>
                {hidden > 0 && i === tiles.length - 1 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-semibold text-white">+{hidden}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      <PhotoViewer photos={photos} index={open} onIndex={setOpen} />
    </>
  )
}

/** 큰 화면 — 좌우 버튼 · 화살표 키 · 밀어 넘기기. 원본은 새 탭으로도 연다 */
function PhotoViewer({ photos, index, onIndex }: { photos: AlbumPhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const touchX = useRef<number | null>(null)
  const p = index === null ? null : photos[index]
  const go = (d: number) => {
    if (index === null) return
    onIndex((index + d + photos.length) % photos.length)
  }

  return (
    <Dialog open={index !== null} onOpenChange={(o) => !o && onIndex(null)}>
      <DialogContent
        className="max-w-[calc(100%-1rem)] gap-3 bg-black p-3 text-white ring-0 sm:max-w-3xl [&>[data-slot=dialog-close]]:min-h-[44px] [&>[data-slot=dialog-close]]:min-w-[44px]"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1)
          if (e.key === "ArrowRight") go(1)
        }}
      >
        {p && (
          <>
            <DialogTitle className="pr-10 text-[13px] font-normal text-white/80">
              {index! + 1} / {photos.length} · {p.title}
            </DialogTitle>
            <div
              // 사진이 아직 안 왔거나 납작해도 넘기기 단추가 위의 닫기 단추를 덮지 않게 높이를 남긴다
              className="relative flex min-h-40 items-center justify-center"
              onTouchStart={(e) => { touchX.current = e.touches[0].clientX }}
              onTouchEnd={(e) => {
                if (touchX.current === null) return
                const dx = e.changedTouches[0].clientX - touchX.current
                touchX.current = null
                if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={apiUrl(`/api/files/${p.sourceId}/raw`)} alt={p.title} className="max-h-[75vh] w-auto max-w-full object-contain" />
              {photos.length > 1 && (
                <>
                  <button type="button" onClick={() => go(-1)} aria-label="이전 사진" className="touch-target absolute left-1 flex size-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                  </button>
                  <button type="button" onClick={() => go(1)} aria-label="다음 사진" className="touch-target absolute right-1 flex size-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                    <HugeiconsIcon icon={ArrowRight01Icon} size={20} />
                  </button>
                </>
              )}
            </div>
            <a href={apiUrl(`/api/files/${p.sourceId}/raw`)} target="_blank" rel="noreferrer" className="touch-target flex items-center justify-self-end text-[12px] text-white/70 underline-offset-2 hover:underline">
              원본 열기
            </a>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
