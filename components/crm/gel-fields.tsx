"use client"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CONC_MAX, CONC_MIN, FREQUENT_CONC, FREQUENT_ML, fmtNum, lotOf, lotText, round3, type GelLot, type GelType } from "@/lib/crm-gel"

/**
 * 젤 타입 칸 고르기 — 자주 쓰는 값은 버튼, 그 밖의 값은 직접 적는다.
 * 생산 팝업 · 출고 · 샘플 · 견적 · 재고 맞추기가 같은 모양을 쓴다(한 화면에서 배운 손짓이 다른 화면에서도 통하게).
 */

export function ChipRow({
  values,
  value,
  onPick,
  unit,
  label,
}: {
  values: number[]
  value: number | null
  onPick: (v: number) => void
  unit: string
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={value === v}
          className={cn(
            "inline-flex h-8 min-w-[3.25rem] items-center justify-center rounded-full border px-3 font-mono text-[12.5px] transition-colors",
            value === v
              ? "border-primary/30 bg-primary/10 font-semibold text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {fmtNum(v)}
          {unit}
        </button>
      ))}
    </div>
  )
}

/** 농도 — 버튼 + 직접 입력. 고른 농도의 지금 재고를 함께 보여 준다 */
export function ConcField({
  gelType,
  value,
  onChange,
  lots,
  id = "gel-conc",
}: {
  gelType: GelType
  value: string
  onChange: (v: string) => void
  lots?: GelLot[]
  id?: string
}) {
  const n = Number(value)
  const valid = value !== "" && Number.isFinite(n) && n >= CONC_MIN && n <= CONC_MAX
  const known = lots ? [...new Set([...FREQUENT_CONC[gelType], ...lots.filter((l) => l.conc > 0 && l.ml > 0).map((l) => l.conc)])].sort((a, b) => a - b) : FREQUENT_CONC[gelType]
  const lot = valid && lots ? lotOf(lots, n) : null
  return (
    <div className="flex flex-col gap-2">
      <ChipRow values={known} value={valid ? round3(n) : null} onPick={(v) => onChange(String(v))} unit="%" label="자주 쓰는 농도" />
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={CONC_MIN}
          max={CONC_MAX}
          step={0.1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="직접 입력"
          aria-label="농도(%)"
          className="h-9 w-[120px] text-right font-mono"
        />
        <span className="text-[12px] text-muted-foreground">% · {CONC_MIN}~{CONC_MAX}</span>
      </div>
      {value !== "" && !valid && (
        <p className="text-[12px] text-destructive">농도는 {CONC_MIN} ~ {CONC_MAX}% 사이로 적어 주세요.</p>
      )}
      {valid && lots && (
        <p className="text-[12px] text-muted-foreground" data-gel-lot-stock>
          지금 재고 <b className="font-mono text-foreground">{lotText(lot)}</b>
        </p>
      )}
    </div>
  )
}

/** ml — 버튼 + 직접 입력. 개수는 세지 않으니 나간(만든) ml 전체를 적는다. 견적만 한 개 용량 */
export function MlField({
  value,
  onChange,
  label = "ml",
}: {
  value: string
  onChange: (v: string) => void
  label?: string
}) {
  const n = Number(value)
  const valid = value !== "" && Number.isFinite(n) && n > 0
  return (
    <div className="flex flex-col gap-2">
      <ChipRow values={FREQUENT_ML} value={valid ? round3(n) : null} onPick={(v) => onChange(String(v))} unit="ml" label="자주 쓰는 ml" />
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="직접 입력"
          aria-label={label}
          className="h-9 w-[120px] text-right font-mono"
        />
        <span className="text-[12px] text-muted-foreground">ml</span>
      </div>
    </div>
  )
}

export const concOk = (v: string) => v !== "" && Number(v) >= CONC_MIN && Number(v) <= CONC_MAX
export const mlOk = (v: string) => v !== "" && Number(v) > 0
