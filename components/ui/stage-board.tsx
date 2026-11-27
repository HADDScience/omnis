"use client"

// 단계 보드 — 열(단계)마다 카드, 카드를 다른 열로 끌어 놓거나(마우스 · 키보드) 카드 메뉴로 단계를 바꾼다.
// 국가과제 우리 결정 보드(PR 280)에서 빼냈다. 지금은 국가과제 · 인증 탭이 같이 쓴다.
// 화면을 먼저 옮기고, 저장이 실패하면 되돌린다. 409(그새 바뀜)면 화면을 새로 읽는다.
// 폰은 끌기 대신 메뉴 — 터치 끌기는 열을 가로로 넘기는 손짓과 겹친다(지원서함 보드와 같다).
import { useEffect, useState, type ReactNode } from "react"
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
import { cn } from "@/lib/utils"

export interface StageColumn<S extends string> {
  stage: S
  label: string
  /** 열 머리의 점 색 */
  dot: string
}

export interface StageBoardProps<S extends string, T extends { id: string; stage: S; title: string }> {
  /** DndContext id · data 속성 이름(data-<name>-board · -column · -card) */
  name: string
  columns: readonly StageColumn<S>[]
  rows: T[]
  /** 카드 겉모양(끌 때 떠오르는 것과 같다) */
  face: (row: T) => ReactNode
  /** 단계를 바꾼다 — 실패하면 던진다(status 409 = 그새 바뀜) */
  save: (row: T, to: S) => Promise<void>
  /** 성공 알림 한 줄 */
  done: (row: T, from: S, to: S) => string
  /** 열 바탕(국가과제는 유리, 인증 탭은 단색) */
  columnClassName: string
  /** 넓은 화면(xl)에서 열을 한 줄에 둘 grid 칸 수 클래스 — 「xl:grid-cols-7」 */
  gridClassName: string
}

/** 화면 먼저 옮기기 · 실패하면 되돌리기 — 그 카드 하나의 단계만 바꾼다 */
export const withStageOf = <S extends string, T extends { id: string; stage: S }>(rows: T[], id: string, stage: S): T[] =>
  rows.map((r) => (r.id === id ? { ...r, stage } : r))

export function StageBoard<S extends string, T extends { id: string; stage: S; title: string }>({
  name,
  columns,
  rows: initial,
  face,
  save,
  done,
  columnClassName,
  gridClassName,
}: StageBoardProps<S, T>) {
  const router = useRouter()
  const [rows, setRows] = useState(initial)
  const [dragging, setDragging] = useState<T | null>(null)
  useEffect(() => setRows(initial), [initial])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  async function move(card: T, to: S) {
    if (to === card.stage || !columns.some((c) => c.stage === to)) return
    const before = card.stage
    setRows((rs) => withStageOf(rs, card.id, to))
    try {
      await save(card, to)
      toast.success(done(card, before, to))
      router.refresh()
    } catch (e) {
      setRows((rs) => withStageOf(rs, card.id, before))
      toast.error(e instanceof Error ? e.message : "바꾸지 못했습니다")
      if ((e as { status?: number }).status === 409) router.refresh()
    }
  }

  function onDragStart(e: DragStartEvent) {
    setDragging(rows.find((r) => r.id === e.active.id) ?? null)
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const card = rows.find((r) => r.id === e.active.id)
    if (card) void move(card, e.over?.id as S)
  }

  return (
    <DndContext
      id={`${name}-board`}
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        className={cn(
          "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 md:snap-none xl:mx-0 xl:grid xl:overflow-visible xl:px-0",
          gridClassName
        )}
        {...{ [`data-${name}-board`]: true }}
      >
        {columns.map((col) => {
          const list = rows.filter((r) => r.stage === col.stage)
          return (
            <Column key={col.stage} name={name} col={col} count={list.length} className={columnClassName}>
              {list.map((r) => (
                <Card key={r.id} name={name} card={r} columns={columns} onMove={move} face={face} />
              ))}
            </Column>
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>{dragging && <Lifted>{face(dragging)}</Lifted>}</DragOverlay>
    </DndContext>
  )
}

function Column<S extends string>({
  name,
  col,
  count,
  className,
  children,
}: {
  name: string
  col: StageColumn<S>
  count: number
  className: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.stage })
  return (
    <section
      ref={setNodeRef}
      aria-label={col.label}
      {...{ [`data-${name}-column`]: col.stage }}
      className={cn(
        "flex w-[82%] shrink-0 snap-start flex-col rounded-2xl p-2.5 transition-shadow md:w-[232px] xl:w-auto xl:min-w-0",
        className,
        isOver && "ring-2 ring-primary/40"
      )}
    >
      <div className="mb-2 flex min-h-8 items-center gap-1.5 px-1.5">
        <span className={cn("size-2 shrink-0 rounded-full", col.dot)} aria-hidden />
        <h2 className="flex items-baseline gap-1.5 text-[13px] font-semibold">
          {col.label} <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        </h2>
      </div>
      <ul className="flex min-h-24 flex-col gap-2">{children}</ul>
    </section>
  )
}

function Card<S extends string, T extends { id: string; stage: S; title: string }>({
  name,
  card,
  columns,
  onMove,
  face,
}: {
  name: string
  card: T
  columns: readonly StageColumn<S>[]
  onMove: (c: T, to: S) => void
  face: (row: T) => ReactNode
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: card.id })
  return (
    <li ref={setNodeRef} className={cn("relative", isDragging && "opacity-40")} {...{ [`data-${name}-card`]: card.id }}>
      <div
        {...listeners}
        {...attributes}
        aria-roledescription="옮길 수 있는 카드"
        aria-label={card.title}
        className="block cursor-grab rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {face(card)}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${card.title} 단계 바꾸기`}
          className="touch-target absolute top-1 right-0.5 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-36">
          <DropdownMenuGroup>
            <DropdownMenuLabel>단계 바꾸기</DropdownMenuLabel>
            {columns
              .filter((c) => c.stage !== card.stage)
              .map((c) => (
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

/** 끌 때 떠오른 카드 — 그림자 · 테두리만 더한다 */
function Lifted({ children }: { children: ReactNode }) {
  return <div className="cursor-grabbing rounded-xl shadow-lg ring-1 ring-foreground/10 [&>*]:bg-background">{children}</div>
}
