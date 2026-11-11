"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import { GridViewIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import { ThumbImage } from "@/components/chat/thumb-image"
import { StatusBadge } from "@/components/ip/status-badge"
import { apiUrl } from "@/lib/base-path"
import { formatDate } from "@/lib/ip/date"
import { coverOf, imageCaseKey, placeholderGlyph, type CaseImage, type RegisterLayout } from "@/lib/ip-images"
import { cn } from "@/lib/utils"
import type { Patent, Trademark } from "@/lib/ip/types"

/** 보기 전환 「목록 / 갤러리」. 고른 것은 이 기기에 기억한다(lib/ip-images.ts readLayout) */
export function LayoutToggle({ value, onChange }: { value: RegisterLayout; onChange: (v: RegisterLayout) => void }) {
  const items = [
    { v: "list" as const, label: "목록", icon: Menu01Icon },
    { v: "gallery" as const, label: "갤러리", icon: GridViewIcon },
  ]
  return (
    <div role="radiogroup" aria-label="보기" className="inline-flex shrink-0 rounded-lg border bg-muted p-0.5">
      {items.map((it) => (
        <button
          key={it.v}
          type="button"
          role="radio"
          aria-checked={value === it.v}
          onClick={() => onChange(it.v)}
          className={cn(
            "touch-target inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] transition-colors",
            value === it.v ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <HugeiconsIcon icon={it.icon} strokeWidth={2} className="size-3.5" />
          {it.label}
        </button>
      ))}
    </div>
  )
}

type Row = Trademark | Patent

/**
 * 갤러리 — 카드 위 절반은 대표 이미지(없으면 이름 첫 글자), 아래 절반은 이름 · 상태 · 번호 · 류 · 기준일.
 * 카드를 누르면 목록의 펼침과 같은 상세가 열린다(부르는 쪽 onOpen).
 * 좁은 폭은 2열 — 글자는 줄이지 않고 자르며(truncate) 번호는 줄을 바꿔 넘치지 않게 한다.
 */
export function CaseGallery({
  kind,
  rows,
  images,
  onOpen,
  focusId,
}: {
  kind: "trademark" | "patent"
  rows: Row[]
  images: Map<string, CaseImage[]>
  onOpen: (row: Row) => void
  focusId?: string
}) {
  if (rows.length === 0) {
    return <p className="rounded-xl border bg-card px-3 py-6 text-center text-[13px] text-muted-foreground">조건에 맞는 건이 없습니다.</p>
  }
  return (
    <ul data-ip-gallery className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {rows.map((row) => (
        <li key={row.id} className="min-w-0">
          <GalleryCard kind={kind} row={row} cover={coverOf(images.get(imageCaseKey(kind, row.id)))} count={images.get(imageCaseKey(kind, row.id))?.length ?? 0} onOpen={() => onOpen(row)} flashing={focusId === row.id} />
        </li>
      ))}
    </ul>
  )
}

function GalleryCard({
  kind,
  row,
  cover,
  count,
  onOpen,
  flashing,
}: {
  kind: "trademark" | "patent"
  row: Row
  cover: CaseImage | null
  count: number
  onOpen: () => void
  flashing: boolean
}) {
  const isPatent = kind === "patent"
  const tm = row as Trademark
  const name = isPatent ? (row as Patent).title : tm.name
  const sub = isPatent ? (row as Patent).applicant : tm.nameKo
  const no = row.regNo ? { label: "등록", value: row.regNo } : row.appNo ? { label: "출원", value: row.appNo } : null
  const refDate = row.registeredOn ?? row.filedOn ?? row.date

  return (
    <button
      type="button"
      data-gallery-card={row.id}
      onClick={onOpen}
      aria-label={`${name} 상세 열기`}
      className={cn(
        "group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        flashing && "hadd-flash"
      )}
    >
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b bg-muted/50">
        {cover ? (
          <ThumbImage
            fileId={cover.fileId}
            original={apiUrl(`/api/files/${cover.fileId}/raw`)}
            cssWidth={320}
            alt={`${name} ${cover.memo || "이미지"}`}
            loading="lazy"
            className="size-full object-contain p-2"
          />
        ) : (
          <span data-gallery-placeholder aria-hidden className="flex size-full items-center justify-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-background text-3xl font-semibold text-muted-foreground shadow-sm sm:size-20 sm:text-4xl">
              {placeholderGlyph(name)}
            </span>
          </span>
        )}
        {count > 1 ? (
          <span className="absolute right-1.5 bottom-1.5 rounded-md bg-background/85 px-1.5 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
            {count}장
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
        <div className="flex min-w-0 items-start justify-between gap-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{name}</span>
            {sub ? <span className="block truncate text-[12px] text-muted-foreground">{sub}</span> : null}
          </span>
          <StatusBadge status={row.status} />
        </div>
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-[11.5px]">
          <dt className="text-muted-foreground">{no?.label ?? "번호"}</dt>
          <dd className="min-w-0 font-mono break-all">{no?.value ?? "—"}</dd>
          {!isPatent ? (
            <>
              <dt className="text-muted-foreground">류</dt>
              <dd className="min-w-0 truncate">{tm.classes.length > 0 ? tm.classes.map((c) => `${c}류`).join(" · ") : "—"}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">기준일</dt>
          <dd className="min-w-0 tabular-nums">{refDate ? formatDate(refDate) : "—"}</dd>
        </dl>
      </div>
    </button>
  )
}
