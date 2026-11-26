"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Attachment01Icon, Download04Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiUrl } from "@/lib/base-path"
import { BOARD_COLUMNS, columnOf, type BoardColumnKey } from "@/lib/hr/jobs"
import { receivedLabel } from "@/lib/hr/format"
import { STAGE_LABEL, canPack, type Stage } from "@/lib/hr/stage-label"
import { cn } from "@/lib/utils"

export interface BoardCard {
  id: string
  code: string | null
  stage: Stage
  name: string | null
  department: string | null
  grade: string | null
  receivedAt: string | null
  fileCount: number
  purged: boolean
}

/** 카드 메뉴의 단계 — 보드 세 열 + 불합격 · 철회 */
const MOVES: { key: BoardColumnKey; label: string; stage: Stage }[] = [
  ...BOARD_COLUMNS.map((c) => ({ key: c.key, label: c.label, stage: c.dropTo as Stage })),
  { key: "out", label: "불합격", stage: "REJECTED" },
  { key: "out", label: "지원 철회", stage: "WITHDRAWN" },
]

/** 보드에서 부르는 이름 — 열 이름과 겹치지 않게(SCREENING 의 「서류」 는 「서류 합격」 열과 헷갈린다) */
const BOARD_STAGE_LABEL: Record<Stage, string> = {
  ...STAGE_LABEL,
  RECEIVED: "접수",
  SCREENING: "서류 검토",
  INTERVIEW: "서류 합격",
  OFFERED: "합격 통보",
  HIRED: "최종 합격",
  WITHDRAWN: "지원 철회",
}

/** 열의 기본 단계와 다를 때만 칩으로 — 접수 열의 「서류」, 서류 합격 열의 「합격」 */
const DEFAULT_OF: Record<string, Stage> = { received: "RECEIVED", passed: "INTERVIEW", hired: "HIRED" }

/**
 * 지원서함 보드 — 접수 · 서류 합격 · 최종 합격. 카드를 다른 열로 끌어 놓거나(마우스 · 키보드) 카드 메뉴로 단계를 바꾼다.
 * 바꾸면 화면이 먼저 움직이고 서버(PATCH /api/hr/applications/[id])가 거절하면 되돌린다. 지원자에게 메일은 가지 않는다.
 * 폰은 끌기 대신 메뉴 — 터치 끌기는 열을 가로로 넘기는 손짓과 겹친다.
 */
export function ApplicationBoard({ cards: initial, jobSlug }: { cards: BoardCard[]; jobSlug: string }) {
  const router = useRouter()
  const [cards, setCards] = useState(initial)
  const [dragging, setDragging] = useState<BoardCard | null>(null)
  const justDragged = useRef(false)
  useEffect(() => setCards(initial), [initial])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

  async function move(card: BoardCard, to: Stage) {
    if (card.stage === to) return
    const before = card.stage
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: to } : c)))
    try {
      const res = await fetch(apiUrl(`/api/hr/applications/${card.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: to }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? "바꾸지 못했습니다")
      toast.success(`${card.name ?? card.code ?? "지원서"} · ${BOARD_STAGE_LABEL[before]} → ${BOARD_STAGE_LABEL[to]}`)
      router.refresh()
    } catch (e) {
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, stage: before } : c)))
      toast.error(e instanceof Error ? e.message : "바꾸지 못했습니다")
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(cards.find((c) => c.id === e.active.id) ?? null)
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
    const card = cards.find((c) => c.id === e.active.id)
    const col = BOARD_COLUMNS.find((c) => c.key === e.over?.id)
    if (!card || !col || columnOf(card.stage) === col.key) return
    void move(card, col.dropTo as Stage)
  }

  const out = cards.filter((c) => columnOf(c.stage) === "out")

  return (
    <DndContext id="hr-board" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:snap-none md:grid-cols-3 md:overflow-visible md:px-0"
        data-hr-columns
      >
        {BOARD_COLUMNS.map((col) => (
          <Column
            key={col.key}
            id={col.key}
            label={col.label}
            count={cards.filter((c) => columnOf(c.stage) === col.key).length}
            bundleHref={col.key === "passed" ? `/api/hr/jobs/${jobSlug}/interview-pack` : undefined}
          >
            {cards
              .filter((c) => columnOf(c.stage) === col.key)
              .map((c) => (
                <Card key={c.id} card={c} column={col.key} onMove={move} suppressClick={justDragged} />
              ))}
          </Column>
        ))}
      </div>

      {out.length > 0 && (
        <details className="group" data-hr-out>
          <summary className="touch-target flex cursor-pointer list-none items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            불합격·철회 <span className="tabular-nums">{out.length}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={2} aria-hidden className="transition-transform group-open:rotate-180" />
          </summary>
          <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
            {out.map((c) => (
              <Card key={c.id} card={c} column="out" onMove={move} suppressClick={justDragged} draggable={false} />
            ))}
          </ul>
        </details>
      )}

      <DragOverlay dropAnimation={null}>{dragging && <CardFace card={dragging} column={columnOf(dragging.stage)} lifted />}</DragOverlay>
    </DndContext>
  )
}

function Column({ id, label, count, bundleHref, children }: { id: string; label: string; count: number; bundleHref?: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-hr-column={id}
      className={cn(
        "glass flex w-[82%] shrink-0 snap-start flex-col rounded-2xl p-2.5 transition-shadow md:w-auto",
        isOver && "ring-2 ring-primary/40",
      )}
    >
      <div className="mb-2 flex min-h-8 items-center justify-between gap-2 px-1.5">
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          {label} <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        </h2>
        {bundleHref && count > 0 && (
          <a
            href={apiUrl(bundleHref)}
            download
            data-hr-bundle
            className="glass-pill touch-target inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition-colors hover:bg-foreground/[0.06]"
          >
            <HugeiconsIcon icon={Download04Icon} size={13} strokeWidth={2} aria-hidden />
            면접자료 PDF
          </a>
        )}
      </div>
      <ul className="flex min-h-24 flex-col gap-2">{children}</ul>
    </section>
  )
}

function Card({
  card,
  column,
  onMove,
  suppressClick,
  draggable = true,
}: {
  card: BoardCard
  column: BoardColumnKey | null
  onMove: (c: BoardCard, to: Stage) => void
  suppressClick: React.RefObject<boolean>
  draggable?: boolean
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: card.id, disabled: !draggable })
  const who = card.name ?? card.code ?? "지원서"
  return (
    <li ref={setNodeRef} className={cn("relative", isDragging && "opacity-40")} data-hr-card={card.code ?? card.id}>
      <Link
        href={`/hr/applications/${card.id}`}
        onClick={(e) => suppressClick.current && e.preventDefault()}
        className="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        {...(draggable ? listeners : {})}
        {...(draggable ? attributes : {})}
        aria-roledescription={draggable ? "옮길 수 있는 카드" : undefined}
        aria-label={`${who} 지원서 열기`}
      >
        <CardFace card={card} column={column} />
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${who} 단계 바꾸기`}
          className="touch-target absolute top-1.5 right-1.5 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>단계 바꾸기</DropdownMenuLabel>
            {MOVES.filter((m) => (m.key === "out" ? card.stage !== m.stage : m.key !== column)).map((m) => (
              <DropdownMenuItem key={m.stage} onClick={() => onMove(card, m.stage)}>
                {m.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {canPack(card.stage) && !card.purged && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.location.assign(apiUrl(`/api/hr/applications/${card.id}/interview-pack`))}>
                <HugeiconsIcon icon={Download04Icon} size={14} strokeWidth={2} aria-hidden />
                면접자료 PDF
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function CardFace({ card, column, lifted }: { card: BoardCard; column: BoardColumnKey | null; lifted?: boolean }) {
  const chip = column === "out" || (column && DEFAULT_OF[column] !== card.stage) ? BOARD_STAGE_LABEL[card.stage] : null
  return (
    <div
      className={cn(
        "rounded-xl bg-background/70 px-3 py-2.5 pr-10 transition-colors hover:bg-background/90",
        lifted && "cursor-grabbing shadow-lg ring-1 ring-foreground/10",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[14px] font-semibold">{card.purged ? "(파기됨)" : card.name}</span>
        {chip && <span className="glass-pill shrink-0 rounded-full px-1.5 py-px text-[11px] text-muted-foreground">{chip}</span>}
      </div>
      {!card.purged && (
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {[card.department, card.grade && `${card.grade}학년`].filter(Boolean).join(" · ")}
        </p>
      )}
      <p className="mt-1 flex items-center gap-2 text-[11.5px] text-muted-foreground tabular-nums">
        <span>{receivedLabel(card.receivedAt)}</span>
        {card.fileCount > 0 && (
          <span className="flex items-center gap-0.5" aria-label={`첨부 ${card.fileCount}개`}>
            <HugeiconsIcon icon={Attachment01Icon} size={12} strokeWidth={2} aria-hidden />
            {card.fileCount}
          </span>
        )}
      </p>
    </div>
  )
}
