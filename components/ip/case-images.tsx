"use client"

import { useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ImageAdd01Icon, StarIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThumbImage } from "@/components/chat/thumb-image"
import { apiUrl } from "@/lib/base-path"
import { removeCaseImage, updateCaseImage, uploadCaseImage } from "@/lib/ip/db"
import { formatDate } from "@/lib/ip/date"
import { IMAGE_MEMO_MAX, IMAGE_MIME, isImageMime, type CaseImage } from "@/lib/ip-images"
import { MAX_UPLOAD_BYTES } from "@/lib/constants"
import { cn } from "@/lib/utils"

/**
 * 건 상세의 「이미지」 칸 — 상표 도안 · 로고 · 시안, 특허 대표 도면.
 * 출원 전 · 아이디어 단계 건에도 건다. 실물은 기존 첨부(POST /api/files)로 올라가고 여기서는 건에 건다.
 * 대표 1장이 갤러리 표지가 된다(안 고르면 가장 최근 것).
 */
export function CaseImages({
  kind,
  entityId,
  title,
  images,
  canWrite,
  today,
  onChanged,
}: {
  kind: "trademark" | "patent"
  entityId: string
  title: string
  images: CaseImage[]
  canWrite: boolean
  today: string
  onChanged: () => Promise<void> | void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<File[]>([])
  const [memo, setMemo] = useState("")
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = kind === "patent" ? "대표 도면 · 그림" : "도안 · 로고 · 시안"

  function pick(list: FileList | null) {
    const files = [...(list ?? [])]
    const bad = files.find((f) => !isImageMime(f.type))
    const big = files.find((f) => f.size > MAX_UPLOAD_BYTES)
    if (bad) setError(`${bad.name}: PNG · JPG · WebP · GIF 만 올릴 수 있습니다 (SVG · PDF · AI 는 PNG 로 내보내 주세요)`)
    else if (big) setError(`${big.name}: ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 이하만 올릴 수 있습니다`)
    else setError(null)
    setPending(files.filter((f) => isImageMime(f.type) && f.size <= MAX_UPLOAD_BYTES))
  }

  async function upload() {
    if (pending.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const file of pending) {
        await uploadCaseImage({ kind, entityId, file, memo: memo.trim(), date: date || null })
      }
      setPending([])
      setMemo("")
      if (fileRef.current) fileRef.current.value = ""
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-case-images aria-label={`${title} 이미지`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[12px] font-medium text-muted-foreground">
          이미지 <span className="font-normal">({label})</span>
          {images.length > 0 ? <span className="ml-1 tabular-nums">{images.length}</span> : null}
        </h4>
      </div>

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {images.map((img) => (
            <ImageTile key={img.id} image={img} canWrite={canWrite} onChanged={onChanged} onError={setError} />
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-muted-foreground">
          아직 이미지가 없습니다.{canWrite ? " 시안 · 도안을 올리면 갤러리 보기의 표지가 됩니다." : ""}
        </p>
      )}

      {canWrite ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_MIME.join(",")}
              multiple
              className="sr-only"
              aria-label={`${title} 이미지 파일 고르기`}
              onChange={(e) => pick(e.target.files)}
            />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <HugeiconsIcon icon={ImageAdd01Icon} strokeWidth={2} className="size-4" />
              이미지 고르기
            </Button>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
              {pending.length === 0 ? "PNG · JPG · WebP · GIF" : pending.length === 1 ? pending[0].name : `${pending.length}장 골랐습니다`}
            </span>
          </div>
          {pending.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                maxLength={IMAGE_MEMO_MAX}
                placeholder="메모 (예: 10/29 변리사 송부 시안)"
                aria-label="이미지 메모"
                className="h-8 min-w-0 flex-1 basis-48 text-[13px]"
              />
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="이미지 날짜"
                className="h-8 w-[9.5rem] text-[13px]"
              />
              <Button type="button" size="sm" onClick={() => void upload()} disabled={busy}>
                {busy ? "올리는 중…" : "올리기"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function ImageTile({
  image,
  canWrite,
  onChanged,
  onError,
}: {
  image: CaseImage
  canWrite: boolean
  onChanged: () => Promise<void> | void
  onError: (msg: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [memo, setMemo] = useState(image.memo)
  const [date, setDate] = useState(image.date ?? "")
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const raw = apiUrl(`/api/files/${image.fileId}/raw`)

  async function run(work: () => Promise<unknown>) {
    setBusy(true)
    onError(null)
    try {
      await work()
      await onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li
      data-case-image
      data-primary={image.isPrimary ? "" : undefined}
      className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card", image.isPrimary && "border-primary")}
    >
      <a href={raw} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] bg-muted/50" title="원본 열기">
        <ThumbImage
          fileId={image.fileId}
          original={raw}
          cssWidth={240}
          alt={image.memo || image.name}
          loading="lazy"
          className="size-full object-contain"
        />
        {image.isPrimary ? (
          <span className="absolute top-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[10.5px] font-medium text-primary-foreground">
            대표
          </span>
        ) : null}
      </a>

      <div className="flex min-w-0 flex-col gap-1 p-1.5 text-[12px]">
        {editing ? (
          <>
            <Input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={IMAGE_MEMO_MAX}
              aria-label="메모 고치기"
              className="h-7 text-[12px]"
            />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="날짜 고치기" className="h-7 text-[12px]" />
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                className="h-7 flex-1 px-2 text-[12px]"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await updateCaseImage(image.id, { memo: memo.trim(), date: date || null })
                    setEditing(false)
                  })
                }
              >
                저장
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setEditing(false)}>
                취소
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="line-clamp-2 break-words">{image.memo || <span className="text-muted-foreground">{image.name}</span>}</span>
            <span className="text-[11px] text-muted-foreground tabular-nums">{image.date ? formatDate(image.date) : "날짜 없음"}</span>
          </>
        )}

        {canWrite && !editing ? (
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11.5px]">
            {!image.isPrimary ? (
              <button
                type="button"
                disabled={busy}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
                onClick={() => void run(() => updateCaseImage(image.id, { isPrimary: true }))}
              >
                <HugeiconsIcon icon={StarIcon} strokeWidth={2} className="size-3" />
                대표로
              </button>
            ) : null}
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setEditing(true)}>
              고치기
            </button>
            {confirmRemove ? (
              <button
                type="button"
                disabled={busy}
                className="font-medium text-red-600 dark:text-red-400"
                onClick={() => void run(() => removeCaseImage(image.id))}
                onBlur={() => setConfirmRemove(false)}
              >
                정말 뗄까요?
              </button>
            ) : (
              <button type="button" className="text-muted-foreground hover:text-red-600" onClick={() => setConfirmRemove(true)}>
                떼기
              </button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}
