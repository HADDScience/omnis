"use client"

import { send } from "@/components/grants/send"
import { STAGE_CHIP, type DecisionView } from "@/components/grants/decision-list"
import { StageBoard } from "@/components/ui/stage-board"
import { BOARD_COLUMNS, cardDue, cardMoney, stageMove } from "@/lib/grants-board"
import { GRANT_STAGE_LABEL, type GrantStage } from "@/lib/grants-labels"

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

const COLUMNS = BOARD_COLUMNS.map((c) => ({ ...c, dot: STAGE_CHIP[c.stage] }))

/**
 * 국가과제 우리 결정 보드 — 단계 일곱 열. 카드를 다른 열로 끌어 놓거나(마우스 · 키보드) 카드 메뉴로 단계를 바꾼다.
 * 제자리 편집과 같은 PATCH(/api/grants/decisions/[id])에 expect(옮기기 전 단계)를 붙인다 — 그새 바뀌었으면 409 로 되돌리고 새 값을 받는다.
 * 열 · 끌기 · 메뉴는 components/ui/stage-board.tsx(인증 탭과 같이 쓴다)
 */
export function DecisionBoard({ rows }: { rows: BoardDecision[] }) {
  return (
    <StageBoard<GrantStage, BoardDecision>
      name="grants"
      columns={COLUMNS}
      rows={rows}
      columnClassName="glass"
      gridClassName="xl:grid-cols-7"
      face={(card) => <CardFace card={card} />}
      save={async (card, to) => {
        const body = stageMove(card.stage, to)
        if (body) await send(`/api/grants/decisions/${card.id}`, "PATCH", body)
      }}
      done={(card, from, to) => `${card.title} · ${GRANT_STAGE_LABEL[from]} → ${GRANT_STAGE_LABEL[to]}`}
    />
  )
}

function CardFace({ card }: { card: BoardDecision }) {
  const due = cardDue(card)
  const money = cardMoney(card)
  return (
    <div className="rounded-xl bg-background/70 px-3 py-2.5 pr-8 transition-colors hover:bg-background/90">
      <p className="line-clamp-3 text-[13.5px] leading-snug font-semibold break-keep [overflow-wrap:anywhere]">
        {card.title}
      </p>
      <p className="mt-1 truncate text-[12px] text-muted-foreground">
        {card.owners.length ? card.owners.map((o) => o.name).join("·") : "담당 없음"}
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
