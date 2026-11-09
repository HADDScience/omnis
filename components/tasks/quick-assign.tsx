"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { QUICK_ASSIGN_SEARCH_AT, quickAssignChoices } from "@/lib/quick-assign"

type Person = { id: string; name: string; former?: boolean }

/**
 * 미배정 업무 상세 위쪽의 「담당자 지정」 칸. 이름 칩을 한 번 누르면 그 사람이 담당이 된다.
 * 저장 · 되돌림은 부모(TaskDetail)가 맡는다 — 여기는 고르기만 한다.
 * 여러 명은 지정한 뒤 담당 옆 연필로 더한다(같은 PATCH 가 통째로 갈아끼운다).
 *
 * 폰: 칩이 44px 높이로 줄바꿈된다. PC: 같은 칩이 낮아져 카드 안 한 줄로 붙는다.
 */
export function QuickAssign({
  choices,
  pendingId,
  onAssign,
}: {
  choices: Person[]
  /** 저장 중인 사람 — 그동안 칩을 모두 막는다 */
  pendingId: string | null
  onAssign: (person: { id: string; name: string }) => void
}) {
  const [query, setQuery] = useState("")
  const all = quickAssignChoices(choices)
  const shown = quickAssignChoices(choices, query)
  const searchable = all.length > QUICK_ASSIGN_SEARCH_AT

  return (
    <section
      data-quick-assign
      aria-labelledby="quick-assign-title"
      className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-3 md:p-4"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="quick-assign-title" className="text-sm font-semibold">
          담당자가 없어요
        </h3>
        <p className="text-xs text-muted-foreground">누르면 바로 담당으로 지정되고 알림이 갑니다</p>
      </div>

      {searchable && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 검색"
          aria-label="담당자 이름 검색"
          className="mb-2 h-[44px] text-sm md:h-8"
        />
      )}

      <ul className="flex flex-wrap gap-2 md:gap-1.5" aria-label="담당자로 지정할 사람">
        {shown.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              data-quick-assign-person={u.id}
              disabled={pendingId !== null}
              onClick={() => onAssign({ id: u.id, name: u.name })}
              aria-label={`${u.name}님을 담당으로 지정`}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-3.5 text-sm font-medium transition-colors hover:bg-muted active:bg-muted disabled:opacity-50 md:min-h-8 md:pr-3 md:text-xs"
            >
              <span
                aria-hidden
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs md:size-6 md:text-[11px]"
              >
                {u.name.charAt(0)}
              </span>
              {pendingId === u.id ? "지정 중…" : u.name}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="py-2 text-xs text-muted-foreground">맞는 이름이 없어요</li>}
      </ul>
    </section>
  )
}
