"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { QUICK_ASSIGN_SEARCH_AT, canSaveAssignees, quickAssignChoices, toggleAssignee } from "@/lib/quick-assign"
import { cn } from "@/lib/utils"

type Person = { id: string; name: string; former?: boolean }

/**
 * 미배정 업무 상세 위쪽의 「담당자 지정」 칸. 이름 칩을 눌러 여러 명을 고르고 「n명 지정」 으로 저장한다(2026-11-11).
 * 저장 · 되돌림은 부모(TaskDetail)가 맡는다 — 여기는 고르기만 한다.
 *
 * 폰: 칩이 44px 높이로 줄바꿈된다. PC: 같은 칩이 낮아져 카드 안 한 줄로 붙는다.
 */
export function QuickAssign({
  choices,
  pending,
  onAssign,
}: {
  choices: Person[]
  /** 저장 중 — 그동안 칩과 단추를 막는다 */
  pending: boolean
  onAssign: (people: { id: string; name: string }[]) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
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
        <p className="text-xs text-muted-foreground">여러 명을 고를 수 있어요 · 지정하면 알림이 갑니다</p>
      </div>
      <AssigneeChips choices={choices} selected={selected} disabled={pending} onToggle={(id) => setSelected((s) => toggleAssignee(s, id))} />
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          data-quick-assign-save
          className="h-11 min-w-24 md:h-8"
          disabled={pending || !canSaveAssignees([], selected)}
          onClick={() => onAssign(choices.filter((c) => selected.includes(c.id)).map(({ id, name }) => ({ id, name })))}
        >
          {pending ? "지정 중…" : selected.length > 0 ? `${selected.length}명 지정` : "지정"}
        </Button>
      </div>
    </section>
  )
}

/**
 * 이름 칩 목록(+ 사람이 많으면 이름 검색). 눌러서 넣고 빼는 토글이다 — 고른 사람은 채운 칩과 체크 표시.
 * 업무 상세의 칸 · 담당 편집, 업무 목록 · 보드의 팝오버 · 바텀시트가 함께 쓴다.
 * 과거 구성원은 새로 고를 수 없지만, 이미 담당이면 칩으로 남아 해제할 수 있다.
 * 폰: 칩이 44px 높이로 줄바꿈된다. PC: 같은 칩이 낮아져 한 줄로 붙는다.
 */
export function AssigneeChips({
  choices,
  selected,
  disabled = false,
  onToggle,
}: {
  choices: Person[]
  selected: readonly string[]
  disabled?: boolean
  onToggle: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  // 과거 구성원은 이미 고른 경우에만 보인다(해제할 수 있게)
  const visible = (q: string) => [
    ...choices.filter((c) => c.former && selected.includes(c.id)),
    ...quickAssignChoices(choices, q),
  ]
  const all = visible("")
  const shown = visible(query)
  const searchable = all.length > QUICK_ASSIGN_SEARCH_AT

  return (
    <>
      {searchable && (
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="이름 검색"
          aria-label="담당자 이름 검색"
          className="mb-2 h-[44px] text-sm md:h-8"
        />
      )}

      <ul className="flex flex-wrap gap-2 md:gap-1.5" aria-label="담당자 고르기">
        {shown.map((u) => {
          const on = selected.includes(u.id)
          return (
            <li key={u.id}>
              <button
                type="button"
                data-quick-assign-person={u.id}
                aria-pressed={on}
                aria-label={u.former ? `${u.name} · 과거 구성원` : u.name}
                disabled={disabled}
                onClick={() => onToggle(u.id)}
                className={cn(
                  "inline-flex min-h-[44px] items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-medium transition-colors disabled:opacity-50 md:min-h-8 md:pr-3 md:text-xs",
                  on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted active:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full text-xs md:size-6 md:text-[11px]",
                    on ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {on ? <HugeiconsIcon icon={Tick02Icon} size={16} /> : u.name.charAt(0)}
                </span>
                {u.name}
                {u.former && <span className="text-[11px] opacity-80">· 과거 구성원</span>}
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className="py-2 text-xs text-muted-foreground">맞는 이름이 없어요</li>}
      </ul>
    </>
  )
}
