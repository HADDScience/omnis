"use client"

import { useEffect, useState } from "react"
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
import { MoreHorizontalIcon } from "@hugeicons/core-free-icons"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { send, SendError } from "@/components/grants/send"
import { STAGE_CHIP, type DecisionView } from "@/components/grants/decision-list"
import {
  BOARD_COLUMNS,
  cardDue,
  cardMoney,
  groupByStage,
  stageMove,
  withStage,
} from "@/lib/grants-board"
import { GRANT_STAGE_LABEL, type GrantStage } from "@/lib/grants-labels"
import { cn } from "@/lib/utils"

export type BoardDecision = Pick<
  DecisionView,
  | "id"
  | "title"
  | "stage"
  | "deadline"
  | "amount"
  | "awardedAmount"
  | "endsOn"
  | "completedOn"
  | "owners"
>

/**
 * 국가과제 우리 결정 보드 — 단계 일곱 열. 카드를 다른 열로 끌어 놓거나(마우스 · 키보드) 카드 메뉴로 단계를 바꾼다.
 * 제자리 편집과 같은 PATCH(/api/grants/decisions/[id])에 expect(옮기기 전 단계)를 붙인다 — 그새 바뀌었으면 409 로 되돌리고 새 값을 받는다.
 * 폰은 끌기 대신 메뉴 — 터치 끌기는 열을 가로로 넘기는 손짓과 겹친다(지원서함 보드와 같다).
 */
export function DecisionBoard({ rows: initial }: { rows: BoardDecision[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [dragging, setDragging] = useState<BoardDecision | null>(null)
  useEffect(() => setRows(initial), [initial])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  async function move(card: BoardDecision, to: GrantStage) {
    const body = stageMove(card.stage, to)
    if (!body) return
    const before = card.stage
    setRows((rs) => withStage(rs, card.id, to))
    try {
      await send(`/api/grants/decisions/${card.id}`, "PATCH", body)
      toast.success(
        `${card.title} · ${GRANT_STAGE_LABEL[before]} → ${GRANT_STAGE_LABEL[to]}`
      )
      router.refresh()
    } catch (e) {
      setRows((rs) => withStage(rs, card.id, before))
      toast.error(e instanceof Error ? e.message : "바꾸지 못했습니다")
      if (e instanceof SendError && e.status === 409) router.refresh()
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(rows.find((r) => r.id === e.active.id) ?? null)
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const card = rows.find((r) => r.id === e.active.id)
    if (card) void move(card, e.over?.id as GrantStage)
  }

  const byStage = groupByStage(rows)

  return (
    <DndContext
      id="grants-board"
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:snap-none xl:mx-0 xl:grid xl:grid-cols-7 xl:overflow-visible xl:px-0"
        data-grants-board
      >
        {BOARD_COLUMNS.map((col) => (
          <Column
            key={col.stage}
            stage={col.stage}
            label={col.label}
            count={byStage[col.stage].length}
          >
            {byStage[col.stage].map((r) => (
              <Card key={r.id} card={r} onMove={move} />
            ))}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && <CardFace card={dragging} lifted />}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  stage,
  label,
  count,
  children,
}: {
  stage: GrantStage
  label: string
  count: number
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      data-grants-column={stage}
      className={cn(
        "glass flex w-[82%] shrink-0 snap-start flex-col rounded-2xl p-2.5 transition-shadow md:w-[232px] xl:w-auto xl:min-w-0",
        isOver && "ring-2 ring-primary/40"
      )}
    >
      <div className="mb-2 flex min-h-8 items-center gap-1.5 px-1.5">
        <span
          className={cn("size-2 shrink-0 rounded-full", STAGE_CHIP[stage])}
          aria-hidden
        />
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          {label}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">
            {count}
          </span>
        </h2>
      </div>
      <ul className="flex min-h-24 flex-col gap-2">{children}</ul>
    </section>
  )
}

function Card({
  card,
  onMove,
}: {
  card: BoardDecision
  onMove: (c: BoardDecision, to: GrantStage) => void
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: card.id,
  })
  return (
    <li
      ref={setNodeRef}
      className={cn("relative", isDragging && "opacity-40")}
      data-grants-card={card.id}
    >
      <div
        {...listeners}
        {...attributes}
        aria-roledescription="옮길 수 있는 카드"
        aria-label={card.title}
        className="block cursor-grab rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <CardFace card={card} />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${card.title} 단계 바꾸기`}
          className="touch-target absolute top-1 right-0.5 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            size={16}
            strokeWidth={2}
            aria-hidden
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>단계 바꾸기</DropdownMenuLabel>
            {BOARD_COLUMNS.filter((c) => c.stage !== card.stage).map((c) => (
              <DropdownMenuItem key={c.stage} onClick={() => onMove(card, c.stage)}>
                {c.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

function CardFace({ card, lifted }: { card: BoardDecision; lifted?: boolean }) {
  const due = cardDue(card)
  const money = cardMoney(card)
  return (
    <div
      className={cn(
        "rounded-xl bg-background/70 px-3 py-2.5 pr-8 transition-colors hover:bg-background/90",
        lifted &&
          "cursor-grabbing bg-background shadow-lg ring-1 ring-foreground/10 hover:bg-background"
      )}
    >
      <p className="line-clamp-3 text-[13.5px] leading-snug font-semibold break-keep [overflow-wrap:anywhere]">
        {card.title}
      </p>
      <p className="mt-1 truncate text-[12px] text-muted-foreground">
        {card.owners.length
          ? card.owners.map((o) => o.name).join("·")
          : "담당 없음"}
      </p>
      {(due || money) && (
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted-foreground tabular-nums">
          {due && <span data-grants-due>{due}</span>}
          {money && <span data-grants-money>{money}</span>}
        </p>
      )}
    </div>
  )
}
