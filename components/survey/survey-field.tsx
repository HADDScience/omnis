"use client"

import { Slider } from "@/components/ui/slider"
import { fieldMode, type Field, type FieldAnswer } from "@/lib/ai-survey/rules"
import { cn } from "@/lib/utils"

/** 이 칸은 폼으로 답이 찼나 — 「보내기」 를 켤지 */
export function isAnswered(f: Field, a: FieldAnswer | undefined): boolean {
  if (!a) return false
  if ("unknown" in a) return true
  if ("choice" in a) return f.kind === "multi" ? a.choice.length >= 1 : a.choice.length === 1
  if ("num" in a) return Number.isFinite(a.num)
  return false
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

/**
 * 질문에 딸린 입력 칸 하나. 두 갈래다(lib/ai-survey/rules.ts fieldMode).
 *   범위 — 슬라이더 · 구간 칩 · 척도(1~5). 숫자를 글로 치지 않는다.
 *   말   — 추천 답 칩. 하나 고르는 칸은 누르면 바로 답이 되고, 여러 개 고르는 칸은 골라서 보낸다. 직접 말하는 입력창은 이 칸 밖(대화 화면)에 있다.
 * 어느 칸이든 「잘 모르겠음」 을 고를 수 있다. onChange 의 둘째 값은 「하나를 골랐다」 — 바로 보내도 되는 누름이다.
 */
export function SurveyField({ field: f, value, onChange }: { field: Field; value: FieldAnswer | undefined; onChange: (a: FieldAnswer | undefined, picked: boolean) => void }) {
  const unknown = isUnknown(value)
  const unknownChip = (instant: boolean) => (
    <Chip dashed on={unknown} onClick={() => onChange(unknown ? undefined : UNKNOWN, instant && !unknown)} data-survey-unknown="">
      잘 모르겠음
    </Chip>
  )

  let body: React.ReactNode
  if (f.kind === "single" || f.kind === "multi" || f.kind === "bucket") {
    const multi = f.kind === "multi"
    const cur = value && "choice" in value ? value.choice : []
    const toggle = (id: string) => {
      if (!multi) return onChange({ choice: [id] }, true)
      const choice = cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id]
      onChange(choice.length ? { choice } : undefined, false)
    }
    body = (
      <div role="group" aria-label={f.label ?? (fieldMode(f) === "chat" ? "추천 답" : "구간")} className="flex flex-wrap gap-2">
        {f.options?.map((o) => (
          <Chip key={o.id} check={multi} on={cur.includes(o.id)} onClick={() => toggle(o.id)} data-survey-option={o.id}>
            {o.label}
          </Chip>
        ))}
        {unknownChip(!multi)}
      </div>
    )
  } else if (f.kind === "slider") {
    const min = f.min ?? 0
    const max = f.max ?? 10
    const n = value && "num" in value ? value.num : null
    const shown = n === null ? null : f.overLabel && n >= max ? f.overLabel : `${n}${f.unit ?? ""}`
    body = (
      <>
        <div className="flex items-baseline justify-between gap-2">
          <span data-survey-slider-value className="text-[22px] font-semibold tabular-nums">
            {shown ?? <span className="text-[14px] font-normal text-muted-foreground">{unknown ? "잘 모르겠음" : "밀어서 골라 주세요"}</span>}
          </span>
          <span className="text-[12px] text-muted-foreground tabular-nums">{min}{f.unit} ~ {f.overLabel ?? `${max}${f.unit ?? ""}`}</span>
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
  } else {
    // 말로만 답하는 칸 — 추천 답이 없다. 입력창에 쓴다
    body = <div className="flex flex-wrap gap-2">{unknownChip(true)}</div>
  }

  return (
    <fieldset data-survey-field={f.id} data-slot-name={f.slot} data-kind={f.kind} data-mode={fieldMode(f)} className="flex min-w-0 flex-col gap-2">
      {f.label && <legend className="mb-1 text-[14px] font-medium">{f.label}</legend>}
      {body}
    </fieldset>
  )
}
