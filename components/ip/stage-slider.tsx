"use client"

import { useId } from "react"

import { StatusBadge } from "@/components/ip/status-badge"
import { cn } from "@/lib/utils"
import type { Stage } from "@/lib/ip/types"

/**
 * 단계 슬라이더 — 이산값 12칸.
 *
 * 드롭다운보다 "어디까지 왔는지"가 한눈에 보인다. 파이프라인이 실제로
 * 순서가 있는 값이라 슬라이더가 의미에 맞는다.
 *
 * 모바일 고려
 *  * 진짜 input[type=range] 라 터치 드래그가 그대로 된다. 키보드 방향키도 된다.
 *  * 손잡이를 24px 로 키워 터치 표적을 확보하고, 트랙 높이를 넉넉히 잡아
 *    빗나간 탭도 먹게 한다.
 *  * 12개 이름을 다 적으면 좁은 화면에서 뭉개지므로, 현재 단계만 크게 보여주고
 *    양 끝만 작게 표시한다. 눈금은 점으로만 찍는다.
 *
 * 등록·거절확정·포기·중단은 서로 이어지는 단계가 아니라 갈라지는 끝점이라
 * 눈금 색을 달리해 구분한다.
 */
export function StageSlider({
  stages,
  value,
  onChange,
  disabled,
}: {
  stages: Stage[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const index = Math.max(
    0,
    stages.findIndex((s) => s.value === value)
  )
  const chosen = stages[index]
  const last = stages.length - 1
  const pct = last === 0 ? 0 : (index / last) * 100

  if (stages.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor={id}
          className="text-[12px] font-medium text-muted-foreground"
        >
          단계
        </label>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {value ? `${index + 1} / ${stages.length}` : ""}
        </span>
      </div>

      <div className="flex items-center gap-2">
        {value ? (
          <StatusBadge status={chosen.value} className="text-[13px]" />
        ) : (
          <span className="text-[13px] text-muted-foreground">
            움직여서 고르세요
          </span>
        )}
        {chosen && !chosen.isOpen ? (
          <span className="text-[11px] text-muted-foreground">
            여기서 끝납니다
          </span>
        ) : null}
      </div>

      <div className="relative px-3 py-2">
        {/*
          손잡이 중심은 thumbW/2 + pct·(trackW − thumbW) 에 놓인다.
          채운 구간을 단순 백분율로 그리면 손잡이보다 짧게 끝나므로 같은 식을 쓴다.
          트랙 양옆 여백 px-3(0.75rem), 손잡이 1.5rem.
        */}
        <div
          className="pointer-events-none absolute top-1/2 left-3 h-1.5 -translate-y-1/2 rounded-full bg-primary"
          style={{
            width: `calc(0.75rem + (100% - 1.5rem - 1.5rem) * ${pct / 100})`,
          }}
          aria-hidden
        />

        {/* 눈금 — 채운 구간 위에 얹어 지나온 칸이 보이게 한다 */}
        <div
          className="pointer-events-none absolute top-1/2 right-6 left-6 flex -translate-y-1/2 justify-between"
          aria-hidden
        >
          {stages.map((s, i) => (
            <span
              key={s.value}
              className={cn(
                "size-1 rounded-full transition-colors",
                i < index
                  ? "bg-background/70"
                  : s.isOpen
                    ? "bg-foreground/20"
                    : "bg-foreground/35"
              )}
            />
          ))}
        </div>

        <input
          id={id}
          type="range"
          min={0}
          max={last}
          step={1}
          value={index}
          disabled={disabled}
          onChange={(e) => onChange(stages[Number(e.target.value)].value)}
          aria-label="단계"
          aria-valuetext={chosen?.value}
          className={cn(
            "relative w-full cursor-pointer appearance-none bg-transparent",
            "focus-visible:outline-none",
            // 트랙
            "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-foreground/10",
            "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-foreground/10",
            // 손잡이 — 터치 표적 24px
            "[&::-webkit-slider-thumb]:mt-[-9px] [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-md",
            "[&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-md",
            "focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-webkit-slider-thumb]:ring-primary/50",
            disabled && "cursor-not-allowed opacity-50"
          )}
        />
      </div>

      <div className="flex justify-between px-1 text-[11px] text-muted-foreground">
        <span>{stages[0].value}</span>
        <span>{stages[last].value}</span>
      </div>
    </div>
  )
}
