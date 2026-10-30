"use client"

import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StageSlider } from "@/components/ip/stage-slider"
import { useData } from "@/components/ip/data-provider"
import { useToday } from "@/hooks/ip/use-today"
import { createCase, saveProgress } from "@/lib/ip/db"
import {
  NEXT_TURN_LABEL,
  NEXT_TURNS,
  PROGRESS_DIRECTIONS,
  RIGHT_KINDS,
} from "@/lib/ip/types"
import type {
  NextTurn,
  ProgressDirection,
  ProgressEntry,
  Stage,
} from "@/lib/ip/types"
import { cn } from "@/lib/utils"

/**
 * 진행 기록 — 사용자가 채우는 유일한 양식.
 *
 * 지식재산권 목록의 번호·날짜·단계는 이 기록이 쌓인 결과이지 따로 입력하는 값이 아니다.
 * 그래서 상표 편집·특허 편집·커뮤니케이션·액션 네 개의 입력창이 여기 하나로 합쳐진다.
 *
 * 화면을 작게 유지하는 장치는 "단계에 따라 필요한 칸만 뜬다"이다.
 * 어느 칸이 필요한지는 ip.status_options 의 wants_* 열에서 오므로,
 * 단계를 추가할 때 이 파일을 고칠 필요가 없다.
 */

const NEW_CASE = "__NEW__"

function blank(date: string): ProgressEntry {
  return {
    id: "",
    date,
    entityKind: "trademark",
    entityId: "",
    stage: "",
    direction: null,
    counterpart: "",
    nextTurn: "none",
    dueOn: null,
    appNo: null,
    regNo: null,
    probability: null,
    // 이름·보유자는 값 정정에서만 쓴다. 일반 기록은 손대지 않는다.
    name: null,
    holder: null,
    note: "",
    source: "manual",
    raw: null,
    // 아직 저장되지 않은 초안이라 적힌 시각이 없다. 서버가 채운다.
    createdAt: "",
  }
}

function Field({
  label,
  hint,
  help,
  children,
  className,
}: {
  label: string
  hint?: string
  help?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={className}>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-[12px] font-medium text-muted-foreground">
          {label}
        </label>
        {help ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${label} 설명`}
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full text-[11px] leading-none font-semibold transition-colors",
              open
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/10 text-muted-foreground hover:bg-foreground/20"
            )}
          >
            ?
          </button>
        ) : null}
      </div>
      {help && open ? (
        <div className="mb-1.5 rounded-md bg-muted/60 px-2 py-1.5 text-[11px]/relaxed text-muted-foreground">
          {help}
        </div>
      ) : null}
      {children}
      {hint ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/** 두세 개짜리 선택은 드롭다운보다 나란한 버튼이 빠르고, 모바일에서 탭 한 번이다. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; disabled?: boolean }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex w-full overflow-hidden rounded-md border">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "min-h-8 flex-1 px-2 text-[13px] font-medium transition-colors",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
            o.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function ProgressForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: ProgressEntry
  onSaved: () => void
  onCancel?: () => void
}) {
  const today = useToday()
  const { trademarks, patents, stages, refresh } = useData()
  const [draft, setDraft] = useState<ProgressEntry>(initial ?? blank(today))
  const [newName, setNewName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (p: Partial<ProgressEntry>) => setDraft((d) => ({ ...d, ...p }))

  const isNew = !draft.id
  const creating = draft.entityId === NEW_CASE

  const stageList = useMemo(
    () =>
      stages
        .filter((s) => s.kind === draft.entityKind && s.selectable)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [stages, draft.entityKind]
  )

  const stage: Stage | undefined = stageList.find(
    (s) => s.value === draft.stage
  )

  /**
   * 건 목록 — 진행 중인 것이 위, 끝난 것(등록·거절확정·포기·중단)이 아래.
   * 끝난 건은 볼 일이 드문데 개수는 계속 늘어나므로 섞여 있으면 목록이 못 쓰게 된다.
   */
  const { live, closed } = useMemo(() => {
    const closedStages = new Set(
      stages
        .filter((s) => s.kind === draft.entityKind && !s.isOpen)
        .map((s) => s.value)
    )
    const rows =
      draft.entityKind === "trademark"
        ? trademarks.map((t) => ({ id: t.id, label: t.name, status: t.status }))
        : patents.map((p) => ({ id: p.id, label: p.title, status: p.status }))

    const byName = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label, "ko")

    return {
      live: rows.filter((r) => !closedStages.has(r.status)).sort(byName),
      closed: rows.filter((r) => closedStages.has(r.status)).sort(byName),
    }
  }, [trademarks, patents, stages, draft.entityKind])

  const caseItems = useMemo(() => {
    const map: Record<string, string> = { [NEW_CASE]: "+ 새 건 등록" }
    for (const r of [...live, ...closed]) map[r.id] = r.label
    return map
  }, [live, closed])

  async function save() {
    if (!draft.entityId) {
      setError("어느 건인지 골라 주세요.")
      return
    }
    if (creating && !newName.trim()) {
      setError("새 건의 이름을 적어 주세요.")
      return
    }
    if (!draft.stage) {
      setError("단계를 골라 주세요.")
      return
    }
    setSaving(true)
    setError(null)
    try {
      let entityId = draft.entityId
      if (creating) {
        entityId = await createCase(
          draft.entityKind,
          newName.trim(),
          (draft.entityKind === "trademark" ? trademarks : patents).map(
            (r) => r.id
          ),
          draft.stage
        )
      }
      await saveProgress({ ...draft, entityId }, isNew)
      await refresh()
      setDraft(blank(today))
      setNewName("")
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-3.5"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault()
          void save()
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
        <Field label="날짜">
          <Input
            type="date"
            value={draft.date}
            onChange={(e) => patch({ date: e.target.value })}
            className="h-9 text-[13px]"
          />
        </Field>

        <Field
          label="부류"
          hint={
            RIGHT_KINDS.some((k) => !k.live)
              ? "실용신안·디자인은 아직 보유 건이 없어 잠겨 있습니다."
              : undefined
          }
        >
          <Segmented
            value={draft.entityKind}
            options={RIGHT_KINDS.map((k) => ({
              value: k.value,
              label: k.label,
              disabled: !k.live,
            }))}
            onChange={(v) =>
              patch({
                entityKind: v as ProgressEntry["entityKind"],
                entityId: "",
                stage: "",
              })
            }
          />
        </Field>
      </div>

      <Field label="건">
        <Select
          items={caseItems}
          value={draft.entityId}
          onValueChange={(v) => patch({ entityId: String(v) })}
        >
          <SelectTrigger className="min-h-9 w-full">
            <SelectValue placeholder="고르거나 새로 등록" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NEW_CASE}>+ 새 건 등록</SelectItem>

            {live.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>진행 중 {live.length}</SelectLabel>
                  {live.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}

            {closed.length > 0 ? (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>종료 {closed.length}</SelectLabel>
                  {closed.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            ) : null}
          </SelectContent>
        </Select>
      </Field>

      {creating ? (
        <Field
          label="새 건 이름"
          hint="번호·날짜는 비워 둡니다. 뒤따르는 기록이 채웁니다."
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={
              draft.entityKind === "trademark" ? "상표명" : "발명의 명칭"
            }
            className="h-9 text-[13px]"
            autoFocus
          />
        </Field>
      ) : null}

      <StageSlider
        stages={stageList}
        value={draft.stage}
        onChange={(v) => patch({ stage: v })}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="방향">
          <Segmented
            value={draft.direction ?? "none"}
            options={[
              ...PROGRESS_DIRECTIONS.map((d) => ({ value: d, label: d })),
              { value: "none" as const, label: "메일 아님" },
            ]}
            onChange={(v) =>
              patch({
                direction: v === "none" ? null : (v as ProgressDirection),
              })
            }
          />
        </Field>

        <Field label="상대">
          <Input
            value={draft.counterpart}
            onChange={(e) => patch({ counterpart: e.target.value })}
            placeholder="대리인 / 대표"
            className="h-9 text-[13px]"
          />
        </Field>
      </div>

      {/* 단계가 요구하는 칸만 나타난다 */}
      {stage &&
      (stage.wantsAppNo || stage.wantsRegNo || stage.wantsProbability) ? (
        <div className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
          {stage.wantsAppNo ? (
            <Field
              label="출원번호"
              hint="앞 두 자리가 부류입니다 — 10 특허 · 20 실용신안 · 30 디자인 · 40 상표"
            >
              <Input
                value={draft.appNo ?? ""}
                onChange={(e) => patch({ appNo: e.target.value || null })}
                placeholder="40-0000-0000000"
                className="h-9 font-mono text-[13px]"
                inputMode="numeric"
              />
            </Field>
          ) : null}

          {stage.wantsRegNo ? (
            <Field label="등록번호">
              <Input
                value={draft.regNo ?? ""}
                onChange={(e) => patch({ regNo: e.target.value || null })}
                placeholder="40-0000000"
                className="h-9 font-mono text-[13px]"
                inputMode="numeric"
              />
            </Field>
          ) : null}

          {stage.wantsProbability ? (
            <Field label="등록가능성 (%)">
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.probability ?? ""}
                onChange={(e) =>
                  patch({
                    probability:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="45"
                className="h-9 text-[13px]"
                inputMode="numeric"
              />
            </Field>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="다음 차례"
          help={
            <>
              <b>지금 누구 차례인지</b>를 적는 칸입니다. 미결 항목을 따로 등록할
              필요가 없습니다.
              <br />
              <br />
              <b>회신 필요</b> — 회신·자료 송부·의견서 제출처럼 우리가 해야 할
              일이 남았을 때. 「밀린 IP 업무」 화면에 뜹니다.
              <br />
              <b>상대 회신 대기</b> — 차례를 넘겼고 답을 기다리는 중. 오래
              걸리면 독촉 대상으로 잡힙니다.
              <br />
              <b>대기 없음</b> — 단순 기록. 아무 데도 안 뜹니다.
              <br />
              <br />
              나중에 회신을 기록하면 이전 항목은 저절로 빠집니다.
            </>
          }
        >
          <Segmented
            value={draft.nextTurn}
            options={NEXT_TURNS.map((t) => ({
              value: t,
              label: NEXT_TURN_LABEL[t],
            }))}
            onChange={(v) => patch({ nextTurn: v as NextTurn })}
          />
        </Field>

        {draft.nextTurn !== "none" || stage?.wantsDue ? (
          <Field
            label="기한"
            hint={stage?.wantsDue ? "의견제출 마감일" : undefined}
          >
            <Input
              type="date"
              value={draft.dueOn ?? ""}
              onChange={(e) => patch({ dueOn: e.target.value || null })}
              className="h-9 text-[13px]"
            />
          </Field>
        ) : null}
      </div>

      <Field label="메모">
        <Textarea
          value={draft.note}
          rows={2}
          onChange={(e) => patch({ note: e.target.value })}
          placeholder="무슨 일이 있었는지 한 줄"
          className="text-[13px]"
        />
      </Field>

      {error ? (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "저장 중…" : isNew ? "기록하기" : "수정하기"}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            취소
          </Button>
        ) : null}
        <span className="ml-auto hidden text-[11px] text-muted-foreground sm:inline">
          ⌘+Enter
        </span>
      </div>
    </div>
  )
}
