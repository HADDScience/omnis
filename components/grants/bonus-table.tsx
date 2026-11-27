import type { BonusView } from "@/lib/grant-bonus-view"
import { OUR_STATE_LABEL, type OurState } from "@/lib/grant-bonus"
import { cn } from "@/lib/utils"

const STATE_CHIP: Record<OurState, string> = {
  held: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  valid: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  expired: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  none: "bg-muted text-muted-foreground",
}

/**
 * 공고 가점 × 우리 인증 — 가점 항목 · 점수 · 우리 상태 · 근거(공고 원문), 맨 아래 예상 합계.
 * 폰에서는 줄마다 항목 · 점수 · 상태를 한 줄에, 근거를 그 아래에 둔다.
 */
export function BonusTable({ bonus }: { bonus: BonusView }) {
  return (
    <section
      aria-label="가점 비교"
      data-grant-bonus
      className="mt-2 rounded-xl bg-background/50 p-3 text-[12px]"
    >
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="text-[12.5px] font-semibold">
          가점
          {bonus.noticeTitle && (
            <span className="ml-1.5 font-normal text-muted-foreground">{bonus.noticeTitle}</span>
          )}
        </h3>
        <p className="tabular-nums" data-grant-bonus-total>
          {bonus.totals.map((t, i) => (
            <span key={t.unit} data-grant-bonus-unit={t.unit}>
              {i > 0 && <span className="text-muted-foreground"> · </span>}
              예상 <strong className="text-[13px] font-semibold">{t.expected}{t.unit}</strong>
              <span className="text-muted-foreground"> / 최대 {t.possible}{t.unit}</span>
            </span>
          ))}
          {bonus.capText && <span className="text-muted-foreground"> · 상한 {bonus.capText}</span>}
        </p>
      </div>
      <table className="w-full border-collapse">
        <thead className="max-sm:hidden">
          <tr className="text-left text-[11.5px] text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-medium">가점 항목</th>
            <th scope="col" className="w-20 py-1 pr-3 font-medium">점수</th>
            <th scope="col" className="w-36 py-1 pr-3 font-medium">우리 상태</th>
            <th scope="col" className="py-1 font-medium">근거</th>
          </tr>
        </thead>
        <tbody>
          {bonus.rows.map((r, i) => (
            <tr
              key={i}
              data-grant-bonus-row={r.state}
              className="border-t border-[var(--glass-edge)] align-top max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-x-2 max-sm:gap-y-1 max-sm:py-2"
            >
              <td className="py-1.5 pr-3 max-sm:p-0">
                <span className="font-medium break-keep">{r.label}</span>
                {r.condition && (
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{r.condition}</span>
                )}
              </td>
              <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums max-sm:p-0 max-sm:text-right">
                {r.pointsLabel}
              </td>
              <td className="py-1.5 pr-3 max-sm:col-span-2 max-sm:p-0">
                <span className={cn("rounded-full px-1.5 py-px text-[11px] font-medium", STATE_CHIP[r.state])}>
                  {OUR_STATE_LABEL[r.state]}
                </span>
                {(r.cert || r.note) && (
                  <span className="ml-1 text-[11.5px] text-muted-foreground">
                    {[r.cert, r.note].filter(Boolean).join(" · ")}
                  </span>
                )}
              </td>
              <td className="py-1.5 max-sm:col-span-2 max-sm:p-0">
                <q className="block border-l-2 border-border pl-2 text-[11.5px] text-muted-foreground before:content-none after:content-none">
                  {r.quote}
                </q>
                {r.source && <span className="mt-0.5 block pl-2 text-[11px] text-muted-foreground/80">{r.source}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** 가점 표가 빈 공고 — 까닭 한 줄(가점 항목 없음 · 첨부 없음 / 첨부를 못 읽음) */
export function BonusEmpty({ text }: { text: string }) {
  return (
    <p className="mt-2 rounded-xl bg-background/50 px-3 py-2 text-[12px] text-muted-foreground" data-grant-bonus-empty>
      <span className="font-semibold text-foreground">가점</span> · {text.replace(/^가점 /, "")}
    </p>
  )
}
