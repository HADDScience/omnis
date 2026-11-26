"use client"

// 공고 보드 머리 — 공고마다 옴니스가 따로 갖는 면접 일시 · 장소 · 방식 · 화상 링크 · 메모를 그 자리에서 고친다.
// 칸 하나씩 PATCH /api/hr/jobs/[slug](고치기 전 값 expect — 그새 바뀌었으면 409). 이 화면은 채용 담당만 연다.
import { useRef, type FocusEvent, type KeyboardEvent } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { InlineField, useFieldSaver, type EditorProps } from "@/components/grants/inline-field"
import { keyAction, sameText, type Equals } from "@/lib/inline-field"
import { INTERVIEW_MODES, MODE_LABEL, type InterviewMode, type InterviewSlot } from "@/lib/schemas/hr-job"
import { slotLabel, sortSlots, type JobMeta } from "@/lib/hr/job-meta"

interface DraftSlot {
  date: string
  time: string
  minutes: string
}

const toDraft = (s: InterviewSlot[]): DraftSlot[] => s.map((x) => ({ date: x.date, time: x.time, minutes: x.minutesEach ? String(x.minutesEach) : "" }))
/** 날짜 · 시각이 다 찬 줄만 보낸다 — 반쯤 적은 줄은 버린다 */
const fromDraft = (d: DraftSlot[]): InterviewSlot[] =>
  sortSlots(
    d
      .filter((x) => x.date && x.time)
      .map((x) => ({ date: x.date, time: x.time, ...(x.minutes.trim() ? { minutesEach: Number(x.minutes) } : {}) })),
  )
const sameSlots: Equals<DraftSlot[]> = (a, b) => JSON.stringify(fromDraft(a)) === JSON.stringify(fromDraft(b))

const text = (v: string) => (v.trim() ? v : null)

export function JobMetaHeader({ meta }: { meta: JobMeta }) {
  const saver = useFieldSaver(`/api/hr/jobs/${meta.jobSlug}`)
  return (
    <section aria-label="면접 정보" data-hr-job-meta={meta.jobSlug} className="glass rounded-2xl px-3 py-2.5 sm:px-4">
      <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-[12.5px] sm:grid-cols-[84px_1fr]">
        <InlineField<DraftSlot[]>
          label="면접 일시"
          value={toDraft(meta.slots)}
          equals={sameSlots}
          display={(v) => {
            const s = fromDraft(v)
            return s.length ? (
              <span className="flex flex-col tabular-nums" data-hr-meta-slots>
                {s.map((x) => (
                  <span key={`${x.date} ${x.time}`}>{slotLabel(x)}</span>
                ))}
              </span>
            ) : null
          }}
          save={saver<DraftSlot[]>("slots", fromDraft)}
          editor={(p) => <SlotsEditor {...p} />}
        />
        <InlineField<string>
          label="면접 장소"
          value={meta.place ?? ""}
          equals={sameText}
          display={text}
          save={saver("place")}
          editor={(p) => <TextEditor {...p} />}
        />
        <InlineField<string>
          label="면접 방식"
          value={meta.mode ?? ""}
          display={(v) => (v ? MODE_LABEL[v as InterviewMode] : null)}
          save={saver("mode")}
          editor={({ draft, commit, bind }) => (
            <NativeSelect {...bind()} size="sm" className="w-full sm:w-48" value={draft} onChange={(e) => commit(e.target.value)}>
              <NativeSelectOption value="">정하지 않음</NativeSelectOption>
              {INTERVIEW_MODES.map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {MODE_LABEL[m]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        />
        {meta.mode === "VIDEO" && (
          <InlineField<string>
            label="화상 링크"
            value={meta.videoUrl ?? ""}
            equals={sameText}
            display={(v) => (v.trim() ? <span className="break-all">{v}</span> : null)}
            save={saver("videoUrl")}
            editor={(p) => <TextEditor {...p} type="url" />}
          />
        )}
        <InlineField<string>
          label="메모"
          value={meta.memo ?? ""}
          equals={sameText}
          display={text}
          save={saver("memo")}
          editor={(p) => <TextEditor {...p} multiline />}
        />
      </dl>
    </section>
  )
}

function TextEditor({ draft, setDraft, bind, multiline = false, type = "text" }: EditorProps<string> & { multiline?: boolean; type?: string }) {
  return multiline ? (
    <Textarea {...bind({ multiline: true })} rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} className="min-h-16 text-[12.5px] md:text-[12.5px]" />
  ) : (
    <Input {...bind()} type={type} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 text-[12.5px] md:text-[12.5px]" />
  )
}

/**
 * 일시 여러 줄 — 날짜 · 시작 시각 · (선택) 한 사람 몇 분. 줄 사이를 옮겨 다니는 동안은 저장하지 않고,
 * 묶음 밖으로 나가거나 Enter 면 저장, Esc 면 취소.
 */
function SlotsEditor({ id, draft, setDraft, commit, cancel }: EditorProps<DraftSlot[]>) {
  const box = useRef<HTMLDivElement>(null)
  const rows = draft.length ? draft : [{ date: "", time: "", minutes: "" }]
  const put = (i: number, patch: Partial<DraftSlot>) => setDraft(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!box.current?.contains(e.relatedTarget as Node | null)) commit(rows)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const act = keyAction(e.key, { composing: e.nativeEvent.isComposing })
    if (!act) return
    e.preventDefault()
    e.stopPropagation()
    if (act === "cancel") cancel()
    else commit(rows)
  }
  return (
    <div ref={box} onBlur={onBlur} onKeyDown={onKeyDown} className="flex flex-col gap-1.5" data-hr-meta-slots-editor>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <Input
            id={i === 0 ? id : undefined}
            autoFocus={i === 0}
            type="date"
            aria-label={`${i + 1}번째 날짜`}
            value={r.date}
            onChange={(e) => put(i, { date: e.target.value })}
            className="h-8 w-[9.5rem] text-[12.5px] md:text-[12.5px]"
          />
          <Input
            type="time"
            step={300}
            aria-label={`${i + 1}번째 시작 시각`}
            value={r.time}
            onChange={(e) => put(i, { time: e.target.value })}
            className="h-8 w-[8.5rem] text-[12.5px] md:text-[12.5px]"
          />
          <label className="inline-flex items-center gap-1 text-muted-foreground">
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              aria-label={`${i + 1}번째 한 사람 시간(분)`}
              value={r.minutes}
              onChange={(e) => put(i, { minutes: e.target.value })}
              className="h-8 w-16 text-[12.5px] md:text-[12.5px]"
            />
            분씩
          </label>
          <button
            type="button"
            aria-label={`${i + 1}번째 일시 빼기`}
            onClick={() => setDraft(rows.filter((_, j) => j !== i))}
            className="touch-target inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} aria-hidden />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setDraft([...rows, { date: rows.at(-1)?.date ?? "", time: "", minutes: rows.at(-1)?.minutes ?? "" }])}
        className="touch-target inline-flex w-fit items-center gap-1 rounded-full px-2.5 text-[12px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={2} aria-hidden />
        일시 더하기
      </button>
    </div>
  )
}
