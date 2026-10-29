"use client"

import { useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { AuthorAvatar } from "@/components/chat/message-parts"
import { apiUrl } from "@/lib/base-path"
import { PEOPLE_PICK_MAX } from "@/lib/chat-people-rules"
import { cn } from "@/lib/utils"

export interface Person {
  id: string
  name: string
}

/**
 * 구성원 고르기 — 이름으로 찾고 여러 명을 고른다. 「사람과 대화」 와 단톡방 초대가 같이 쓴다.
 * 목록은 GET /api/users(로그인할 수 있는 구성원). 나와 `exclude`(이미 방에 있는 사람)는 고를 수 없다.
 */
export function PeoplePicker({
  meId,
  exclude = [],
  selected,
  onChange,
  autoFocus = false,
}: {
  meId: string
  exclude?: string[]
  selected: Person[]
  onChange: (next: Person[]) => void
  autoFocus?: boolean
}) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    fetch(apiUrl("/api/users"))
      .then(async (r) => {
        if (!r.ok) throw new Error("구성원 목록을 불러오지 못했어요")
        return (await r.json()) as Person[]
      })
      .then((rows) => alive && setPeople(rows))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [attempt])

  const skip = useMemo(() => new Set([meId, ...exclude]), [meId, exclude])
  const picked = useMemo(() => new Set(selected.map((p) => p.id)), [selected])
  const needle = q.trim().toLowerCase()
  const shown = (people ?? []).filter((p) => !skip.has(p.id) && (!needle || p.name.toLowerCase().includes(needle)))
  const full = selected.length >= PEOPLE_PICK_MAX

  function toggle(p: Person) {
    if (picked.has(p.id)) onChange(selected.filter((s) => s.id !== p.id))
    else if (!full) onChange([...selected, p])
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selected.length > 0 && (
        <ul aria-label="고른 사람" className="flex shrink-0 flex-wrap gap-1.5 px-4 pt-3">
          {selected.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => toggle(p)}
                aria-label={`${p.name} 빼기`}
                className="touch-target inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pr-1.5 pl-1 text-[12px] in-data-[messenger]:gap-1.5 in-data-[messenger]:py-1 in-data-[messenger]:pr-3 in-data-[messenger]:text-[15px] text-primary hover:bg-primary/15 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <AuthorAvatar name={p.name} size={18} lgSize={28} />
                {p.name}
                <HugeiconsIcon icon={Cancel01Icon} size={11} aria-hidden className="in-data-[messenger]:size-[15px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="shrink-0 px-4 pt-3">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="이름으로 찾기"
          aria-label="대화할 사람 찾기"
          autoFocus={autoFocus}
          className="touch-target h-8 text-[12.5px] in-data-[messenger]:h-[50px] in-data-[messenger]:rounded-xl in-data-[messenger]:px-4 in-data-[messenger]:text-[16px]!"
        />
        {full && <p className="pt-1.5 text-[11px] text-muted-foreground in-data-[messenger]:text-[13.5px]">한 번에 {PEOPLE_PICK_MAX}명까지 고를 수 있어요</p>}
      </div>
      <ul aria-label="구성원" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        {error ? (
          <li className="flex flex-col items-start gap-2 px-3 py-2 text-[12px] text-destructive in-data-[messenger]:text-[14.5px]">
            {error}
            <Button variant="outline" size="sm" className="touch-target" onClick={() => setAttempt((n) => n + 1)}>
              다시 불러오기
            </Button>
          </li>
        ) : people === null ? (
          Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex items-center gap-2.5 px-2 py-1.5 in-data-[messenger]:gap-3.5 in-data-[messenger]:py-3">
              <Skeleton className="size-7 rounded-full in-data-[messenger]:size-11" />
              <Skeleton className="h-3.5 w-24 in-data-[messenger]:h-4 in-data-[messenger]:w-32" />
            </li>
          ))
        ) : shown.length === 0 ? (
          <li className="px-3 py-2 text-[12px] text-muted-foreground in-data-[messenger]:text-[14.5px]">
            {needle ? `「${q.trim()}」 에 맞는 사람이 없어요` : "고를 수 있는 사람이 없어요"}
          </li>
        ) : (
          shown.map((p) => {
            const on = picked.has(p.id)
            return (
              <li key={p.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={!on && full}
                  onClick={() => toggle(p)}
                  className="touch-target flex w-full min-w-0 items-center gap-2.5 rounded-md px-2 py-1.5 text-left in-data-[messenger]:gap-3.5 in-data-[messenger]:rounded-xl in-data-[messenger]:px-3 in-data-[messenger]:py-2.5 hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border in-data-[messenger]:size-6",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                    )}
                  >
                    {on && <HugeiconsIcon icon={Tick02Icon} size={11} className="in-data-[messenger]:size-4" />}
                  </span>
                  <AuthorAvatar name={p.name} size={28} lgSize={44} />
                  <span className="min-w-0 flex-1 truncate text-[13px] in-data-[messenger]:text-[16.5px]">{p.name}</span>
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
