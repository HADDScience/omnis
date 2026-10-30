"use client"

import { useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ip/ip-dialog"
import { Input } from "@/components/ui/input"
import { StatusBadge } from "@/components/ip/status-badge"
import { formatDate } from "@/lib/ip/date"
import { correctRecord, type Correction, type OpeningState } from "@/lib/ip/db"
import { NEXT_TURN_LABEL, type ProgressEntry } from "@/lib/ip/types"
import { cn } from "@/lib/utils"

/**
 * 값 정정 — 지식재산권 목록을 직접 찌르지 않는다.
 *
 * 고치면 진행 기록 한 줄이 생기고, 지식재산권 목록은 그 기록의 결과로 바뀐다. 그래서
 * 무엇이 언제 왜 바뀌었는지가 이력에 남는다. 단계는 건드리지 않는다 — 정정은
 * 일이 진행된 것이 아니기 때문이다.
 */
export function CorrectionForm({
  entityKind,
  entityId,
  stage,
  today,
  current,
  stageOptions,
  onSaved,
  inline = false,
}: {
  entityKind: "trademark" | "patent"
  entityId: string
  stage: string
  today: string
  current: {
    name: string
    holder: string | null
    appNo: string | null
    regNo: string | null
    filedOn: string | null
    registeredOn: string | null
  }
  /** 고를 수 있는 단계. 파이프라인 순서대로 들어온다. */
  stageOptions: string[]
  onSaved: () => Promise<void>
  /**
   * 이미 「고치러 온 자리」에 놓을 때. 상세 화면처럼 편집이 목적인 곳에서는
   * 버튼을 한 번 더 누르게 하지 않는다.
   */
  inline?: boolean
}) {
  const [open, setOpen] = useState(inline)
  const [draft, setDraft] = useState<Correction>({})
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nameLabel = entityKind === "trademark" ? "이름" : "명칭"
  const holderLabel = entityKind === "trademark" ? "보유자" : "출원인"

  if (!open) {
    return (
      <Button
        size="xs"
        variant="outline"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        값 고치기
      </Button>
    )
  }

  const fields: {
    key: "name" | "holder" | "appNo" | "regNo" | "filedOn" | "registeredOn"
    label: string
    now: string | null
    /** 이름·명칭은 비울 수 없다. 지식재산권 목록에서 not null 이다. */
    clearable: boolean
    /**
     * 날짜 칸. 출원일·등록일은 진행 기록의 날짜로 한 번 채워질 뿐 그 뒤로는
     * 바뀌지 않으므로, 틀렸으면 여기서 근거 문서의 날짜로 고친다.
     */
    date?: boolean
  }[] = [
    { key: "name", label: nameLabel, now: current.name, clearable: false },
    { key: "holder", label: holderLabel, now: current.holder, clearable: true },
    { key: "appNo", label: "출원번호", now: current.appNo, clearable: true },
    { key: "regNo", label: "등록번호", now: current.regNo, clearable: true },
    { key: "filedOn", label: "출원일", now: current.filedOn, clearable: true, date: true },
    { key: "registeredOn", label: "등록일", now: current.registeredOn, clearable: true, date: true },
  ]

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col gap-2 rounded-lg border p-2.5"
    >
      <p className="text-[12px] text-muted-foreground">
        고친 내용은 <b>진행 기록 한 줄</b>로 남습니다. 손대지 않은 칸은 그대로
        둡니다. 단계를 바꾸는 것은 &ldquo;원래부터 이 단계였다&rdquo;는 뜻이라
        마지막 진행일을 움직이지 않습니다 — 지금 진행된 일이라면 「기록하기」에
        남기세요.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => {
          const cleared = draft[f.key] === ""
          return (
            <div key={f.key}>
              <div className="mb-0.5 flex items-center gap-1.5">
                <label className="text-[11.5px] text-muted-foreground">
                  {f.label}
                  {/* 날짜 입력은 placeholder 를 보여주지 않아 지금 값을 여기 적는다. */}
                  {f.date ? ` (지금: ${f.now ? formatDate(f.now) : "비어 있음"})` : null}
                </label>
                {f.clearable && f.now ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        [f.key]: cleared ? undefined : "",
                      }))
                    }
                    className={cn(
                      "px-1 text-[11px] transition-colors",
                      cleared
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {cleared ? "비움 취소" : "비우기"}
                  </button>
                ) : null}
              </div>
              <Input
                type={f.date && !cleared ? "date" : "text"}
                value={cleared ? "" : (draft[f.key] ?? "")}
                disabled={cleared}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [f.key]: e.target.value }))
                }
                placeholder={cleared ? "(비웁니다)" : (f.now ?? "(비어 있음)")}
                className="h-7 text-[12px]"
              />
            </div>
          )
        })}

        <div>
          <label className="mb-0.5 block text-[11.5px] text-muted-foreground">
            단계
          </label>
          {/*
            "지금 등록됐다"는 진행이라 「기록하기」에 남겨야 한다. 여기서 바꾸는
            것은 "원래부터 이 단계였다"는 정정이라 마지막 진행일을 움직이지 않는다.
          */}
          <select
            value={draft.stage ?? stage}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                stage: e.target.value === stage ? undefined : e.target.value,
              }))
            }
            className="h-7 w-full bg-background px-1.5 text-[12px] rounded-md border"
          >
            {stageOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-0.5 block text-[11.5px] text-muted-foreground">
          왜 고치는지
        </label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="예: 오타 정정"
          className="h-7 text-[12px]"
        />
      </div>

      {error ? (
        <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      <div className="flex gap-1.5">
        <Button
          size="xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              await correctRecord(
                entityKind,
                entityId,
                stage,
                today,
                draft,
                reason
              )
              await onSaved()
              // 편집이 목적인 자리에서는 저장했다고 양식이 사라지면 안 된다.
              if (!inline) setOpen(false)
              setDraft({})
              setReason("")
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? "저장 중…" : "저장"}
        </Button>
        {inline ? null : (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            취소
          </Button>
        )}
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<string, string> = {
  manual: "직접 입력",
  mail: "메일",
  excel: "엑셀 인수",
  edit: "값 정정",
}

/** 펼친 줄 안에 그대로 두는 기록 수. 넘치면 나머지는 모달로 민다. */
const INLINE_LIMIT = 3

/**
 * 진행 이력 — 기록 한 줄에 담긴 것을 전부 보여준다.
 *
 * 요약만 보이면 "무슨 일이 있었는지"를 알 수 없어 결국 DB 를 열어보게 된다.
 * 값이 바뀐 칸은 무엇이 무엇으로 바뀌었는지까지 적는다.
 *
 * 다만 오래 굴러간 건은 이력이 길어져, 표 한가운데서 다 펼치면 아래 건들이
 * 화면 밖으로 밀려난다. 그래서 최근 몇 건만 자리에 두고 전체는 모달에서 본다 —
 * 읽는 자리와 훑는 자리를 나눈다.
 */
export function ProgressHistory({
  entries,
  opening,
  title,
}: {
  entries: ProgressEntry[]
  /** 이 건을 이어받은 시점. 기록이 아니라 출발선이라 다른 모양으로 놓는다. */
  opening?: OpeningState
  /** 모달 제목에 쓸 건 이름 */
  title?: string
}) {
  const sorted = sortHistory(entries)
  const overflow = sorted.length > INLINE_LIMIT

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium text-muted-foreground">
          진행 이력 {sorted.length}건
        </span>
        {overflow ? (
          <Dialog>
            <DialogTrigger
              onClick={(e) => e.stopPropagation()}
              className="px-1.5 py-0.5 text-[11.5px] font-medium text-muted-foreground rounded-md border transition-colors hover:text-foreground"
            >
              전체 보기
            </DialogTrigger>
            <DialogContent onClick={(e) => e.stopPropagation()}>
              <DialogHeader className="pr-10">
                <DialogTitle>진행 이력{title ? ` · ${title}` : ""}</DialogTitle>
                <DialogDescription>
                  최신 기록이 위입니다. 모두 {sorted.length}건.
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
                <HistoryList entries={sorted} opening={opening} />
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      {sorted.length === 0 && !opening ? (
        <p className="text-muted-foreground">기록이 없습니다.</p>
      ) : (
        <>
          <HistoryList
            entries={overflow ? sorted.slice(0, INLINE_LIMIT) : sorted}
            // 출발선은 이력의 맨 끝이다. 잘라 보여줄 때 붙이면 중간이 빠진 채
            // 끝만 보여 거짓말이 된다.
            opening={overflow ? undefined : opening}
          />
          {overflow ? (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              오래된 {sorted.length - INLINE_LIMIT}건은 「전체 보기」에서 볼 수
              있습니다.
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}

/**
 * 최신이 위.
 *
 * 날짜만으로는 같은 날 기록의 순서가 정해지지 않아, 적힌 시각으로 한 번 더
 * 가른다. 정정은 대개 원본 기록 뒤에 붙으므로 이 순서가 실제 사건 순서다.
 */
function sortHistory(entries: ProgressEntry[]): ProgressEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  )
}

function HistoryList({
  entries,
  opening,
}: {
  entries: ProgressEntry[]
  opening?: OpeningState
}) {
  return (
    <ul className="flex flex-col divide-y divide-border/60">
      {entries.map((h) => (
        <li key={h.id} className="flex flex-col gap-1 py-2 first:pt-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
              {formatDate(h.date)}
            </span>
            <StatusBadge status={h.stage} />
            {h.direction ? (
              <Badge className="bg-muted text-muted-foreground">
                {h.direction}
              </Badge>
            ) : null}
            {h.counterpart ? (
              <span className="text-muted-foreground">{h.counterpart}</span>
            ) : null}
            <Badge
              className={cn(
                "ml-auto",
                h.source === "edit"
                  ? "bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {SOURCE_LABEL[h.source] ?? h.source}
            </Badge>
          </div>

          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-20 text-[12px] text-muted-foreground">
            {h.nextTurn !== "none" ? (
              <span>다음 차례 · {NEXT_TURN_LABEL[h.nextTurn]}</span>
            ) : null}
            {h.dueOn ? <span>기한 · {formatDate(h.dueOn)}</span> : null}
            {h.name ? <span>이름 → {h.name}</span> : null}
            {h.holder ? <span>보유자 → {h.holder}</span> : null}
            {h.appNo ? <span>출원번호 → {h.appNo}</span> : null}
            {h.regNo ? <span>등록번호 → {h.regNo}</span> : null}
            {h.probability !== null ? (
              <span>등록가능성 · {h.probability}%</span>
            ) : null}
          </div>

          {h.note ? (
            <p className="pl-20 whitespace-pre-wrap text-foreground">
              {h.note}
            </p>
          ) : null}

          {/*
            근거 원문. AI 도구가 메일에서 옮겨 적을 때 요약만 남기면 「정말
            그렇게 적혀 있었나」를 확인할 길이 없다 — 실제로 인용된 원본을
            새 메일로 착각해 없던 사실이 적힌 일이 있었다. 접어 두되, 한 번에
            펼칠 수 있게 한다.
          */}
          {h.raw ? (
            <details className="pl-20">
              <summary className="w-fit cursor-pointer text-[12px] text-muted-foreground transition-colors select-none hover:text-foreground">
                근거 원문
              </summary>
              <p className="mt-1 border-l-2 border-border/60 bg-muted/40 py-1.5 pl-2 text-[12px]/relaxed whitespace-pre-wrap text-muted-foreground">
                {h.raw}
              </p>
            </details>
          ) : null}
        </li>
      ))}

      {opening ? (
        <li className="flex flex-col gap-1 border-t-2 border-dashed border-border py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="w-20 shrink-0 text-muted-foreground tabular-nums">
              {formatDate(opening.takenOverOn)}
            </span>
            <span className="font-medium">여기서부터 이어받음</span>
            <StatusBadge status={opening.stage} />
          </div>
          <p className="pl-20 text-[12px] text-muted-foreground">
            {opening.sourceNote}. 이 줄은 사건이 아니라 <b>출발선</b>입니다 —
            우리가 이 상태를 넘겨받은 날이지, 그날 무슨 일이 있었다는 뜻이
            아닙니다.
            {opening.refDate
              ? ` 넘겨받을 당시 마지막 진행일은 ${formatDate(opening.refDate)} 였습니다.`
              : " 넘겨받을 당시 마지막 진행일은 비어 있었습니다."}
          </p>
        </li>
      ) : null}
    </ul>
  )
}
