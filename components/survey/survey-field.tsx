"use client"

import { useState } from "react"

import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { OTHER_MAX, TEXT_MAX, type Field, type FieldAnswer } from "@/lib/ai-survey/rules"
import { cn } from "@/lib/utils"

/** 이 칸은 답이 찼나 — 「다음」 을 켤지 */
export function isAnswered(f: Field, a: FieldAnswer | undefined): boolean {
  if (!a) return false
  if ("unknown" in a) return true
  if ("choice" in a) {
    const n = a.choice.length + (a.other?.trim() ? 1 : 0)
    return f.kind === "single" ? n === 1 : n >= 1
  }
  if ("num" in a) return Number.isFinite(a.num)
  return a.text.trim().length > 0
}

/** 보기 칩 — 누르는 자리 44px(.touch-target), 긴 글은 줄을 바꾼다 */
function Chip({ on, check, dashed, onClick, children, ...rest }: { on: boolean; check?: boolean; dashed?: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, string | undefined>) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "touch-target inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-left text-[15px] break-keep transition-colors [overflow-wrap:anywhere] focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        dashed && "border-dashed text-muted-foreground",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
      )}
      {...rest}
    >
      {check && (
        <span aria-hidden className={cn("flex size-[16px] shrink-0 items-center justify-center rounded-[4px] border text-[11px] leading-none", on ? "border-primary-foreground" : "border-muted-foreground/60")}>
          {on ? "✓" : ""}
        </span>
      )}
      {children}
    </button>
  )
}

const UNKNOWN: FieldAnswer = { unknown: true }
const isUnknown = (a: FieldAnswer | undefined) => !!a && "unknown" in a

/** 구독료 칸의 빠른 보기 — 숫자를 치지 않고 고른다 */
const FEE_PRESETS = [30_000, 60_000, 150_000, 300_000]

/**
 * 질문에 딸린 입력 칸 하나. 종류: 보기 칩(single) · 체크(multi) · 슬라이더 · 숫자 · 척도(1~5) · 한 줄 글.
 * 어느 종류든 「잘 모르겠음」 을 고를 수 있다. onChange 의 둘째 값은 「보기를 하나 골랐다」 — 바로 넘어가도 되는 누름이다.
 */
export function SurveyField({ field: f, value, onChange }: { field: Field; value: FieldAnswer | undefined; onChange: (a: FieldAnswer | undefined, picked: boolean) => void }) {
  const [otherOpen, setOtherOpen] = useState(false)
  const unknown = isUnknown(value)
  const unknownChip = (instant: boolean) => (
    <Chip dashed on={unknown} onClick={() => { setOtherOpen(false); onChange(unknown ? undefined : UNKNOWN, instant && !unknown) }} data-survey-unknown="">
      잘 모르겠음
    </Chip>
  )

  let body: React.ReactNode
  if (f.kind === "single" || f.kind === "multi") {
    const multi = f.kind === "multi"
    const cur = value && "choice" in value ? value : { choice: [] as string[], other: undefined as string | undefined }
    const toggle = (id: string) => {
      if (multi) {
        const choice = cur.choice.includes(id) ? cur.choice.filter((c) => c !== id) : [...cur.choice, id]
        onChange(choice.length || cur.other ? { choice, ...(cur.other ? { other: cur.other } : {}) } : undefined, false)
      } else {
        setOtherOpen(false)
        onChange({ choice: [id] }, true)
      }
    }
    const setOther = (text: string) => {
      const choice = multi ? cur.choice : []
      onChange(text || choice.length ? { choice, ...(text ? { other: text } : {}) } : undefined, false)
    }
    body = (
      <>
        <div role="group" aria-label={f.label ?? "보기"} className="flex flex-wrap gap-2">
          {f.options?.map((o) => (
            <Chip key={o.id} check={multi} on={cur.choice.includes(o.id)} onClick={() => toggle(o.id)} data-survey-option={o.id}>
              {o.label}
            </Chip>
          ))}
          {f.allowOther && (
            <Chip
              check={multi}
              on={otherOpen && !unknown}
              onClick={() => {
                const open = !otherOpen || unknown
                setOtherOpen(open)
                if (!open) setOther("")
                else if (unknown || !multi) onChange(undefined, false)
              }}
              data-survey-other=""
            >
              기타
            </Chip>
          )}
          {unknownChip(!multi)}
        </div>
        {f.allowOther && otherOpen && !unknown && (
          <Input
            autoFocus
            aria-label="기타 — 한 줄로"
            placeholder="한 줄로 적어 주세요"
            maxLength={OTHER_MAX}
            value={cur.other ?? ""}
            onChange={(e) => setOther(e.target.value)}
            className="h-[44px] text-[16px] md:text-[15px]"
          />
        )}
      </>
    )
  } else if (f.kind === "slider") {
    const min = f.min ?? 0
    const max = f.max ?? 10
    const n = value && "num" in value ? value.num : null
    body = (
      <>
        <div className="flex items-baseline justify-between gap-2">
          <span data-survey-slider-value className="text-[22px] font-semibold tabular-nums">
            {n === null ? <span className="text-[14px] font-normal text-muted-foreground">{unknown ? "잘 모르겠음" : "밀어서 골라 주세요"}</span> : `${n}${f.unit ?? ""}`}
          </span>
          <span className="text-[12px] text-muted-foreground tabular-nums">{min}{f.unit} ~ {max}{f.unit}</span>
        </div>
        {/* 처음 값(맨 왼쪽)을 그대로 고르려는 누름도 답으로 받는다 — 값이 안 바뀌면 onValueChange 가 오지 않는다.
            capture 로 먼저 받는다: 버블 단계에서 받으면 슬라이더가 정한 값을 이 줄이 맨 왼쪽 값으로 덮는다 */}
        <div
          className="touch-target flex items-center px-1"
          onPointerDownCapture={() => { if (n === null) onChange({ num: min }, false) }}
          onKeyDown={(e) => { if (n === null && e.key.startsWith("Arrow")) onChange({ num: min }, false) }}
        >
          <Slider
            aria-label={f.label ?? "값"}
            min={min}
            max={max}
            step={f.step ?? 1}
            value={[n ?? min]}
            onValueChange={(v) => onChange({ num: Array.isArray(v) ? v[0] : v }, false)}
          />
        </div>
        <div className="flex flex-wrap gap-2">{unknownChip(false)}</div>
      </>
    )
  } else if (f.kind === "scale") {
    const n = value && "num" in value ? value.num : null
    body = (
      <>
        <div role="group" aria-label={f.label ?? "1~5"} className="grid grid-cols-5 gap-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              aria-pressed={n === i}
              onClick={() => onChange({ num: i }, false)}
              className={cn("touch-target min-h-[44px] rounded-lg border text-[16px] font-medium tabular-nums transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", n === i ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
              data-survey-scale={i}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="flex justify-between gap-2 text-[12px] text-muted-foreground"><span>{f.minLabel}</span><span className="text-right">{f.maxLabel}</span></div>
        <div className="flex flex-wrap gap-2">{unknownChip(false)}</div>
      </>
    )
  } else if (f.kind === "number") {
    const n = value && "num" in value ? value.num : null
    const fee = f.slot === "monthlyFeeKrw"
    body = (
      <>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            inputMode="decimal"
            aria-label={f.label ?? "숫자"}
            min={f.min}
            max={f.max}
            step={f.step}
            value={n ?? ""}
            onChange={(e) => {
              const v = e.target.value === "" ? NaN : Number(e.target.value)
              onChange(Number.isFinite(v) ? { num: Math.min(Math.max(v, f.min ?? 0), f.max ?? v) } : undefined, false)
            }}
            className="h-[44px] w-40 text-[16px] tabular-nums"
          />
          {f.unit && <span className="text-[15px] text-muted-foreground">{f.unit}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {fee && FEE_PRESETS.map((p) => (
            <Chip key={p} on={n === p} onClick={() => onChange({ num: p }, false)} data-survey-preset={String(p)}>
              {(p / 10_000).toLocaleString("ko-KR")}만원
            </Chip>
          ))}
          {unknownChip(false)}
        </div>
      </>
    )
  } else {
    body = (
      <>
        <Input
          aria-label={f.label ?? "한 줄 답"}
          placeholder="한 줄로 적어 주세요"
          maxLength={TEXT_MAX}
          value={value && "text" in value ? value.text : ""}
          onChange={(e) => onChange(e.target.value ? { text: e.target.value } : undefined, false)}
          className="h-[44px] text-[16px] md:text-[15px]"
        />
        <div className="flex flex-wrap gap-2">{unknownChip(false)}</div>
      </>
    )
  }

  return (
    <fieldset data-survey-field={f.id} data-slot-name={f.slot} data-kind={f.kind} className="flex min-w-0 flex-col gap-2">
      {f.label && <legend className="mb-1 text-[14px] font-medium">{f.label}</legend>}
      {body}
    </fieldset>
  )
}
