"use client"

// 한 방의 사진 모아보기 — 최신순 격자. 방 서랍이 생기면 그쪽으로 옮긴다.
import { useCallback, useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { ThumbImage } from "@/components/chat/thumb-image"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

export interface RoomPhoto {
  fileId: string
  name: string
  messageId: string
  createdAt: string
  author: { id: string; name: string }
  mine: boolean
}

export function RoomPhotoGrid({ roomId, onClose, onPick }: { roomId: string; onClose: () => void; onPick: (photo: RoomPhoto, all: RoomPhoto[]) => void }) {
  const [photos, setPhotos] = useState<RoomPhoto[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async (before: string | null) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ roomId, ...(before ? { before } : {}) })
      const res = await fetch(apiUrl(`/api/chat/photos?${params}`))
      if (!res.ok) throw new Error(String(res.status))
      const page = (await res.json()) as { photos: RoomPhoto[]; nextBefore: string | null }
      setPhotos((prev) => (before ? [...prev, ...page.photos] : page.photos))
      setNext(page.nextBefore)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [roomId])
  useEffect(() => void load(null), [load])

  return (
    <div role="dialog" aria-modal="true" aria-label="이 방 사진" className="fixed inset-0 z-[60] flex flex-col bg-neutral-950 text-white">
      <div className="flex items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)] pb-2">
        <button type="button" onClick={onClose} aria-label="모아보기 닫기" className="touch-target inline-flex size-[44px] items-center justify-center rounded-full bg-white/12 hover:bg-white/20">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={22} aria-hidden />
        </button>
        <h2 className="text-[17px] font-semibold">사진</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-[max(env(safe-area-inset-bottom),12px)]">
        <ul className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((p) => (
            <li key={p.fileId}>
              <button type="button" onClick={() => onPick(p, photos)} aria-label={`${p.author.name}의 사진 ${p.name}`} className="block aspect-square w-full overflow-hidden bg-white/5">
                <ThumbImage fileId={p.fileId} original={apiUrl(`/api/files/${p.fileId}/raw`)} cssWidth={140} loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
        {loading && <Spinner className="mx-auto my-6 size-5" />}
        {!loading && error && <p className="py-8 text-center text-[14px] text-white/70">사진을 불러오지 못했습니다</p>}
        {!loading && !error && photos.length === 0 && <p className="py-8 text-center text-[14px] text-white/70">이 방에 사진이 없습니다</p>}
        {!loading && next && (
          <button type="button" onClick={() => void load(next)} className="touch-target mx-auto my-4 block rounded-full bg-white/12 px-4 py-2 text-[14px]">
            더 보기
          </button>
        )}
      </div>
    </div>
  )
}
