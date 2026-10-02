"use client"

import { useEffect, useMemo, useRef, useState } from "react"

/**
 * 연혁·실적 타임라인 — 종류마다 한 줄, 사건마다 점 하나.
 *
 * 종류는 줄의 위치와 이름표가 구분한다. 그래서 점은 한 색이다 — 8종을 색으로 가르면
 * 색약 기준을 넘길 수 없고(산점도는 3색이 한계), 위치로 이미 갈렸는데 색까지 쓸 이유가 없다.
 * 표 대신 보는 것은 아래 목록이다. 점을 누르면 그 줄로 내려간다.
 */

export interface TimelineEvent {
  id: string
  kind: string
  title: string
  /** YYYY-MM-DD */
  date: string
  organizer: string | null
}

interface Props {
  events: TimelineEvent[]
  /** 표시 순서대로 [종류, 이름] */
  kinds: [string, string][]
  /** 날짜가 없어 그리지 못한 건수 */
  undated: number
}

const LANE_H = 36
const LABEL_Y = 12
const DOT_Y = 26
const AXIS_H = 34
const PAD_X = 6
const R = 4
const HIT = 9

const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`)

export function RecordsTimeline({ events, kinds, undated }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  const [hover, setHover] = useState<{
    lane: number
    ids: string[]
    x: number
    y: number
  } | null>(null)
  const lastTap = useRef<string | null>(null)
  const armed = useRef(false)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.floor(e.contentRect.width))
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 사건이 있는 종류만 줄을 만든다 — 종류로 거르면 한 줄만 남는다
  const lanes = useMemo(
    () => kinds.filter(([k]) => events.some((e) => e.kind === k)),
    [kinds, events]
  )

  const { start, end, years } = useMemo(() => {
    const ys = events.map((e) => Number(e.date.slice(0, 4)))
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const list = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
    return {
      start: Date.UTC(y0, 0, 1),
      end: Date.UTC(y1 + 1, 0, 1),
      years: list,
    }
  }, [events])

  const perYear = useMemo(() => {
    const m = new Map<number, number>()
    for (const e of events)
      m.set(
        Number(e.date.slice(0, 4)),
        (m.get(Number(e.date.slice(0, 4))) ?? 0) + 1
      )
    return m
  }, [events])

  const plotH = lanes.length * LANE_H
  const height = plotH + AXIS_H
  const w = width ?? 0
  const x = (ms: number) =>
    PAD_X + ((ms - start) / (end - start)) * (w - PAD_X * 2)

  const points = useMemo(
    () =>
      events.map((e) => ({
        ...e,
        lane: lanes.findIndex(([k]) => k === e.kind),
        ms: toMs(e.date),
      })),
    [events, lanes]
  )

  const today = Date.now()
  const showToday = today >= start && today < end

  function pick(clientX: number, clientY: number) {
    const svg = wrap.current?.querySelector("svg")
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    // 화면 배율(--ui-zoom)이 걸려 있어 화면 좌표와 SVG 좌표가 다르다 — 비율로 되돌린다
    const scale = box.width > 0 ? w / box.width : 1
    const px = (clientX - box.left) * scale
    const py = (clientY - box.top) * scale
    const lane = Math.floor(py / LANE_H)
    if (lane < 0 || lane >= lanes.length) return null
    const near = points
      .filter((p) => p.lane === lane && Math.abs(x(p.ms) - px) <= HIT)
      .sort((a, b) => a.ms - b.ms)
    if (near.length === 0) return null
    return { lane, ids: near.map((p) => p.id), x: px, y: lane * LANE_H + DOT_Y }
  }

  const hovered = hover ? points.filter((p) => hover.ids.includes(p.id)) : []

  return (
    <>
      <div ref={wrap} className="relative w-full" style={{ height }}>
        {width !== null && w > 0 && (
          <svg
            width={w}
            height={height}
            role="img"
            aria-label={`연혁 타임라인 — ${years[0]}~${years[years.length - 1]}년 ${events.length}건. ${lanes
              .map(
                ([k, label]) =>
                  `${label} ${events.filter((e) => e.kind === k).length}건`
              )
              .join(", ")}`}
            className="block touch-manipulation select-none"
            onPointerMove={(ev) => setHover(pick(ev.clientX, ev.clientY))}
            onPointerLeave={(ev) => {
              if (ev.pointerType === "mouse") setHover(null)
            }}
            onPointerDown={(ev) => {
              const hit = pick(ev.clientX, ev.clientY)
              // 터치는 첫 탭이 미리보기, 같은 점을 한 번 더 누르면 이동한다.
              // 상태가 아니라 ref 로 본다 — click 이 올 때는 이미 이번 탭으로 상태가 바뀌어 있다.
              armed.current =
                ev.pointerType !== "touch" ||
                (hit !== null && lastTap.current === hit.ids[0])
              lastTap.current = hit?.ids[0] ?? null
              setHover(hit)
            }}
            onClick={(ev) => {
              const hit = pick(ev.clientX, ev.clientY)
              if (!hit || !armed.current) return
              document
                .getElementById(`rec-${hit.ids[0]}`)
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }}
          >
            {/* 줄 배경 — 번갈아 아주 옅게. 격자는 뒤로 물러나 있어야 한다 */}
            {lanes.map(([k], i) => (
              <rect
                key={k}
                x={0}
                y={i * LANE_H}
                width={w}
                height={LANE_H}
                className={i % 2 ? "fill-transparent" : "fill-muted/40"}
              />
            ))}

            {/* 해 경계 */}
            {years.map((y) => {
              const gx = x(Date.UTC(y, 0, 1))
              return (
                <line
                  key={y}
                  x1={gx}
                  x2={gx}
                  y1={0}
                  y2={plotH + 4}
                  className="stroke-border"
                  strokeWidth={1}
                />
              )
            })}

            {showToday && (
              <g>
                <line
                  x1={x(today)}
                  x2={x(today)}
                  y1={0}
                  y2={plotH}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
              </g>
            )}

            {/* 종류 이름 — 줄 위쪽에 겹쳐 둔다. 왼쪽 칸을 따로 두면 좁은 화면에서 그림이 사라진다 */}
            {lanes.map(([k, label], i) => (
              <text
                key={k}
                x={PAD_X + 2}
                y={i * LANE_H + LABEL_Y}
                className="fill-muted-foreground text-[11px]"
                dominantBaseline="middle"
              >
                {label} · {events.filter((e) => e.kind === k).length}
              </text>
            ))}

            {/* 점 — 겹치면 바탕색 테두리로 갈라 보이게 */}
            {points.map((p) => (
              <circle
                key={p.id}
                cx={x(p.ms)}
                cy={p.lane * LANE_H + DOT_Y}
                r={hover?.ids.includes(p.id) ? R + 1.5 : R}
                className="fill-primary stroke-card"
                strokeWidth={1.5}
              />
            ))}

            {/* 축 — 해와 그해 건수 */}
            {years.map((y) => {
              const cx = (x(Date.UTC(y, 0, 1)) + x(Date.UTC(y + 1, 0, 1))) / 2
              return (
                <g key={y}>
                  <text
                    x={cx}
                    y={plotH + 14}
                    textAnchor="middle"
                    className="fill-foreground text-[11.5px] font-medium tabular-nums"
                  >
                    {y}
                  </text>
                  <text
                    x={cx}
                    y={plotH + 28}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[11px] tabular-nums"
                  >
                    {perYear.get(y) ?? 0}건
                  </text>
                </g>
              )
            })}
          </svg>
        )}

        {hover && hovered.length > 0 && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 w-max max-w-[min(280px,90%)] rounded-lg border bg-popover px-3 py-2 text-[12px] text-popover-foreground shadow-md"
            style={{
              top: hover.y + 10,
              // 오른쪽 끝에서는 왼쪽으로 펼친다 — 좁은 화면에서 넘치지 않게
              ...(hover.x > w / 2
                ? { right: Math.max(0, w - hover.x - 12) }
                : { left: Math.max(0, hover.x - 12) }),
            }}
          >
            <ul className="flex flex-col gap-1">
              {hovered.slice(0, 4).map((p) => (
                <li key={p.id} className="min-w-0">
                  <span className="text-muted-foreground tabular-nums">
                    {p.date.replaceAll("-", ".")}
                  </span>{" "}
                  <span className="font-medium break-words">{p.title}</span>
                  {p.organizer && (
                    <span className="block truncate text-muted-foreground">
                      {p.organizer}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {hovered.length > 4 && (
              <p className="mt-1 text-muted-foreground">
                외 {hovered.length - 4}건
              </p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              눌러서 목록에서 보기
            </p>
          </div>
        )}
      </div>
      {undated > 0 && (
        <p className="mt-1 text-right text-[11px] text-muted-foreground">
          날짜 없는 {undated}건은 그리지 않았습니다
        </p>
      )}
    </>
  )
}
