"use client"

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { FilterHorizontalIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import { CALENDAR_GROUPS, type CalendarGroup, type CalendarResponse } from "@/lib/calendar/types"
import type { CalendarPrefs } from "./calendar-view"
import { calendarTone, groupTone } from "./tones"

function ago(iso: string | null) {
  if (!iso) return "아직 안 됨"
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return "방금"
  if (s < 3600) return `${Math.round(s / 60)}분 전`
  if (s < 86400) return `${Math.round(s / 3600)}시간 전`
  return `${Math.round(s / 86400)}일 전`
}

/** 무엇을 볼지. 켜고 끈 것은 이 브라우저에 남는다. 관리자는 웍스 캘린더를 구성원에게 열고 닫는다 */
export function CalendarFilters({
  prefs,
  onChange,
  data,
  isAdmin,
  onAudienceChanged,
}: {
  prefs: CalendarPrefs
  onChange: (p: CalendarPrefs) => void
  data: CalendarResponse | null
  isAdmin: boolean
  onAudienceChanged: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const calendars = data?.calendars ?? []
  const order = calendars.map((c) => c.id)

  const toggleGroup = (g: CalendarGroup, on: boolean) =>
    onChange({ ...prefs, groups: on ? [...new Set([...prefs.groups, g])] : prefs.groups.filter((x) => x !== g) })
  const toggleCalendar = (id: string, on: boolean) =>
    onChange({
      ...prefs,
      hiddenCalendars: on ? prefs.hiddenCalendars.filter((x) => x !== id) : [...new Set([...prefs.hiddenCalendars, id])],
    })

  async function setAudience(id: string, all: boolean) {
    setSaving(id)
    try {
      const res = await fetch(`/api/calendar/calendars/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audience: all ? "ALL" : "ADMIN" }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`)
      toast.success(all ? "구성원 모두에게 보입니다" : "관리자에게만 보입니다")
      onAudienceChanged()
    } catch (err) {
      toast.error(`공개범위를 바꾸지 못했습니다 — ${err instanceof Error ? err.message : ""}`)
    } finally {
      setSaving(null)
    }
  }

  const worksOn = prefs.groups.includes("works")

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="touch-target" />}>
        <HugeiconsIcon icon={FilterHorizontalIcon} size={14} />
        보기
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(320px,calc(100vw-2rem))] p-3">
        <div className="mb-1 text-[12px] font-medium text-muted-foreground">옴니스</div>
        <ul className="mb-3 flex flex-col">
          {CALENDAR_GROUPS.filter((g) => g.key !== "works").map((g) => {
            const on = prefs.groups.includes(g.key)
            const id = `cal-group-${g.key}`
            return (
              <li key={g.key} className="flex min-h-[36px] items-center gap-2">
                <Checkbox id={id} checked={on} onCheckedChange={(v) => toggleGroup(g.key, v === true)} />
                <span className={`size-2 rounded-full ${groupTone(g.key as Exclude<CalendarGroup, "works">).dot}`} aria-hidden />
                <label htmlFor={id} className="flex-1 cursor-pointer text-[13px]">
                  {g.label}
                </label>
                {g.key === "tasks" && on && (
                  <button
                    type="button"
                    onClick={() => onChange({ ...prefs, taskScope: prefs.taskScope === "mine" ? "all" : "mine" })}
                    className="rounded-full border px-2 py-0.5 text-[11.5px] hover:border-border-strong"
                    aria-label={`업무 범위: ${prefs.taskScope === "mine" ? "내 업무" : "전체"} — 눌러서 바꾸기`}
                  >
                    {prefs.taskScope === "mine" ? "내 업무" : "전체"}
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <Checkbox id="cal-group-works" checked={worksOn} onCheckedChange={(v) => toggleGroup("works", v === true)} />
          <label htmlFor="cal-group-works" className="cursor-pointer">
            네이버 웍스
          </label>
        </div>
        {!data?.worksConfigured ? (
          <p className="text-[12px] text-muted-foreground">웍스 연동이 설정되지 않았습니다.</p>
        ) : calendars.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {isAdmin ? "아직 들여온 캘린더가 없습니다. 잠시 뒤 다시 열어 보세요." : "열려 있는 회사 캘린더가 없습니다."}
          </p>
        ) : (
          <ul className={`flex flex-col ${worksOn ? "" : "opacity-50"}`}>
            {calendars.map((c) => {
              const on = !prefs.hiddenCalendars.includes(c.id)
              const id = `cal-works-${c.id}`
              return (
                <li key={c.id} className="py-1">
                  <div className="flex min-h-[32px] items-center gap-2">
                    <Checkbox id={id} checked={on} disabled={!worksOn} onCheckedChange={(v) => toggleCalendar(c.id, v === true)} />
                    <span className={`size-2 rounded-full ${calendarTone(c.id, order).dot}`} aria-hidden />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate text-[13px]">
                      {c.displayName}
                    </label>
                  </div>
                  <div className="ml-6 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted-foreground">
                    <span>동기화 {ago(c.syncedAt)}</span>
                    {isAdmin && (
                      <label className="flex items-center gap-1.5">
                        <Switch
                          size="sm"
                          checked={c.audience === "ALL"}
                          disabled={saving === c.id}
                          onCheckedChange={(v) => setAudience(c.id, v)}
                          aria-label={`${c.displayName} 구성원에게 공개`}
                        />
                        {c.audience === "ALL" ? "구성원 공개" : "관리자만"}
                      </label>
                    )}
                  </div>
                  {isAdmin && c.lastError && (
                    <p className="ml-6 text-[11.5px] text-destructive" role="alert">
                      {c.lastError}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
