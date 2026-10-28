"use client"

import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { Calendar03Icon, Location01Icon, RepeatIcon } from "@hugeicons/core-free-icons"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { spanLabel, timeLabel } from "@/lib/calendar/grid"
import type { CalendarItem } from "@/lib/calendar/types"
import { toneOf } from "./tones"

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"]

function dayTitle(key: string) {
  const [y, m, d] = key.split("-").map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${m}월 ${d}일 (${WEEKDAY[wd]})`
}

/** 고른 날의 일정. 좁은 화면에서는 칸에 점만 있으므로 여기가 본문이다 */
export function DayAgenda({
  dateKey,
  items,
  longItems,
  calendarOrder,
}: {
  dateKey: string
  items: CalendarItem[]
  longItems: CalendarItem[]
  calendarOrder: string[]
}) {
  return (
    <aside aria-label={`${dayTitle(dateKey)} 일정`} className="min-w-0 lg:sticky lg:top-4 lg:self-start">
      <h2 className="mb-2 flex items-baseline gap-2 text-[14px] font-semibold">
        {dayTitle(dateKey)}
        <span className="text-[12px] font-normal text-muted-foreground">{items.length}건</span>
      </h2>

      {items.length === 0 ? (
        <Empty className="border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Calendar03Icon} size={18} />
            </EmptyMedia>
            <EmptyTitle className="text-[13px]">이 날 일정이 없습니다</EmptyTitle>
            <EmptyDescription className="text-[12px]">다른 날을 고르거나, 위 「보기」 에서 출처를 켜 보세요.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <AgendaRow key={i.id} item={i} calendarOrder={calendarOrder} />
          ))}
        </ul>
      )}

      {/* 지원사업 · 프로젝트처럼 몇 달씩 걸친 것은 그날의 일정과 섞으면 그날 무엇이 있는지 묻힌다 */}
      {longItems.length > 0 && (
        <section aria-label="이 날에 걸친 기간" className="mt-3">
          <h3 className="mb-1 text-[11.5px] font-medium text-muted-foreground">이 날에 걸친 기간 · {longItems.length}</h3>
          <ul className="flex flex-col">
            {longItems.map((i) => {
              const tone = toneOf(i, calendarOrder)
              const inner = (
                <>
                  <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{i.title}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{spanLabel(i)}</span>
                </>
              )
              const row = "flex min-w-0 items-center gap-1.5 rounded px-1 py-1 text-[12.5px]"
              return (
                <li key={i.id} className="min-w-0">
                  {i.href ? (
                    <Link href={i.href} className={`${row} hover:bg-muted`}>
                      {inner}
                    </Link>
                  ) : (
                    <div className={row}>{inner}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </aside>
  )
}

function AgendaRow({ item, calendarOrder }: { item: CalendarItem; calendarOrder: string[] }) {
  const tone = toneOf(item, calendarOrder)
  const when = item.allDay ? "종일" : `${timeLabel(item.start)} – ${timeLabel(item.end)}`
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
        <span className="shrink-0 tabular-nums">{when}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{item.tag}</span>
        {item.recurring && <HugeiconsIcon icon={RepeatIcon} size={12} aria-label="반복 일정" className="shrink-0" />}
      </div>
      <div className={`min-w-0 text-[13.5px] leading-snug break-keep [overflow-wrap:anywhere] ${item.muted ? "text-muted-foreground line-through decoration-1" : ""}`}>
        {item.title}
      </div>
      {item.location && (
        <div className="mt-0.5 flex min-w-0 items-center gap-1 text-[12px] text-muted-foreground">
          <HugeiconsIcon icon={Location01Icon} size={12} aria-hidden className="shrink-0" />
          <span className="min-w-0 truncate">{item.location}</span>
        </div>
      )}
    </>
  )
  const box = `block min-w-0 rounded-md border-l-[3px] bg-card px-2.5 py-1.5 ${tone.bar}`
  return (
    <li className="min-w-0">
      {item.href ? (
        <Link href={item.href} className={`${box} touch-target transition-colors hover:bg-muted`}>
          {body}
        </Link>
      ) : (
        // 웍스 일정은 옴니스에 원본이 없다 — 읽기 전용으로만 보여 준다
        <div className={box} title="네이버 웍스 일정 · 옴니스에서는 읽기만 한다">
          {body}
        </div>
      )}
    </li>
  )
}
