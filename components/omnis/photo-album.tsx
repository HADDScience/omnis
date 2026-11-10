"use client"

// 옴니스 답의 사진 묶음 — 카톡 「묶어 보내기」처럼 정사각 격자 한 덩어리. 누르면 큰 화면에서 넘겨 본다.
// 묶을 사진 고르기 · 줄 나누기는 lib/photo-album.ts.
import { useState } from "react"
import { PhotoViewer } from "@/components/photo-viewer/photo-viewer"
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
      {/* 채팅 사진과 같은 뷰어. 답의 사진은 글이 아니라 근거라 이름 · 시각 · 삭제 · 공유가 없다 */}
      <PhotoViewer
        photos={photos.map((p) => ({ fileId: p.sourceId, name: p.title, original: apiUrl(`/api/files/${p.sourceId}/raw`) }))}
        index={open}
        onIndex={setOpen}
        onClose={() => setOpen(null)}
      />
    </>
  )
}
