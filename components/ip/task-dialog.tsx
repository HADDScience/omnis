"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ip/ip-dialog"
import { StatusBadge, StaleDays } from "@/components/ip/status-badge"
import { CorrectionForm } from "@/components/ip/record-detail"
import { MailThread, useMailFor } from "@/components/ip/mail-thread"
import { useData } from "@/components/ip/data-provider"
import { useAuth } from "@/components/ip/auth-gate"
import { useToday } from "@/hooks/ip/use-today"
import { setTurnAndDue } from "@/lib/ip/db"
import { daysBetween, formatDate } from "@/lib/ip/date"
import { NEXT_TURNS, NEXT_TURN_LABEL } from "@/lib/ip/types"
import type { NextTurn, Patent, ProgressEntry, Trademark } from "@/lib/ip/types"
import { cn } from "@/lib/utils"

/** 다음 차례 칩 색 — 우리 차례는 붉게, 상대 차례는 호박색, 대기 없음은 회색 */
const TURN_TONE: Record<NextTurn, string> = {
  us: "bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300",
  firm: "bg-amber-500/15 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  none: "bg-muted text-muted-foreground",
}

/**
 * 밀린 업무 하나를 여는 자리.
 *
 * 「이거 왜 우리 차례지?」에 답하려면 두 가지가 한 화면에 있어야 한다 — 무슨
 * 메일이 오갔는지(왼쪽)와 이 건의 값이 지금 어떤지(오른쪽). 둘을 오가느라
 * 화면을 옮겨 다니면 확인하다 잊는다.
 *
 * 오른쪽은 두 칸이다(2026-10-29 「뭘 하려는 건지 모르겠다」 뒤 다시 나눔).
 *   ① 지금 상태 — 누구 차례 · 기한 · 마지막 기록. 「차례·기한 바꾸기」를 눌러야 편집이 열린다
 *   ② 등록 정보 — 확인용. 값이 있는 칸만 보이고, 틀렸을 때 「값 고치기」로 새 기록 한 줄을 남긴다
 */
export function TaskDialog({
  entryId,
  onClose,
}: {
  /** 열려 있는 기록. null 이면 닫힌 상태다. */
  entryId: string | null
  onClose: () => void
}) {
  const { progress } = useData()

  // 저장하면 데이터가 갈리므로 객체를 붙들지 않고 매번 id 로 다시 찾는다.
  const entry = useMemo(
    () => (entryId ? (progress.find((e) => e.id === entryId) ?? null) : null),
    [progress, entryId]
  )

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[64rem]">
        {entry ? <TaskDetail key={entry.id} entry={entry} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function TaskDetail({ entry }: { entry: ProgressEntry }) {
  const today = useToday()
  const { trademarks, patents, stages, refresh } = useData()
  const { canWrite } = useAuth()

  const kind = entry.entityKind
  const isPatent = kind === "patent"
  const trademark: Trademark | undefined = isPatent
    ? undefined
    : trademarks.find((t) => t.id === entry.entityId)
  const patent: Patent | undefined = isPatent
    ? patents.find((p) => p.id === entry.entityId)
    : undefined

  const name = patent?.title ?? trademark?.name ?? entry.entityId
  const holder = patent?.applicant ?? trademark?.holder ?? null
  const status = patent?.status ?? trademark?.status ?? entry.stage
  const row = patent ?? trademark

  const mails = useMailFor(kind, entry.entityId)

  const pipeline = useMemo(
    () =>
      stages
        .filter((s) => s.kind === kind)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => s.value),
    [stages, kind]
  )

  // 값이 있는 칸만 표로, 빈 칸은 이름만 한 줄로 — 「—」 줄이 절반이면 읽을 것이 묻힌다
  const allFacts: [string, string | null, boolean?][] = [
    [isPatent ? "명칭" : "이름", name],
    ...(!isPatent ? ([["한글명", trademark?.nameKo || null]] as [string, string | null][]) : []),
    [isPatent ? "출원인" : "보유자", holder],
    ["출원번호", row?.appNo ?? null, true],
    ["등록번호", row?.regNo ?? null, true],
    ["출원일", row?.filedOn ? formatDate(row.filedOn) : null],
    ["등록일", row?.registeredOn ? formatDate(row.registeredOn) : null],
    ...(!isPatent
      ? ([
          ["류", trademark?.classes.join(", ") || null],
          ["지정상품", trademark?.goods || null],
          [
            "등록가능성",
            trademark?.probability === null || trademark?.probability === undefined
              ? null
              : `${trademark.probability}%`,
          ],
        ] as [string, string | null][])
      : []),
    ["마지막 진행", row?.date ? formatDate(row.date) : null],
    ["비고", row?.note || null],
  ]
  const facts = allFacts.filter((f): f is [string, string, boolean?] => !!f[1])
  const empty = allFacts.filter((f) => !f[1]).map((f) => f[0])

  const [editing, setEditing] = useState(false)
  const [turn, setTurn] = useState<NextTurn>(entry.nextTurn)
  const [due, setDue] = useState(entry.dueOn ?? "")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    turn !== entry.nextTurn || (due || null) !== (entry.dueOn ?? null)
  const overdue = entry.dueOn !== null && entry.dueOn < today

  async function saveTurn() {
    setBusy(true)
    setError(null)
    try {
      await setTurnAndDue(entry.id, turn, due || null)
      await refresh()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader className="pr-10">
        <DialogTitle className="flex flex-wrap items-center gap-2">
          {name}
          <StatusBadge status={status} />
        </DialogTitle>
        <DialogDescription>
          왼쪽은 이 건으로 주고받은 메일, 오른쪽은 지금 누구 차례인지와 등록 정보입니다.
        </DialogDescription>
      </DialogHeader>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:grid-cols-2 md:overflow-hidden">
        {/* 폰에서는 한 줄로 쌓인다 — 짧은 「지금 상태」가 DOM 에서도 먼저라 창이 열릴 때 초점 · 스크롤이 맨 위에 선다. PC 에서는 오른쪽 칸 */}
        <section className="flex shrink-0 flex-col gap-4 border-b border-border/60 px-4 pb-4 md:order-last md:border-l md:min-h-0 md:shrink md:overflow-y-auto md:border-b-0 md:pt-0">
          {/* ① 지금 누구 차례인가 — 이 창을 연 이유. 맨 위에 크게 */}
          <div>
            <h3 className="z-10 mb-1.5 bg-popover py-1 md:sticky md:top-0 text-[12px] font-medium text-muted-foreground">
              지금 상태
            </h3>
            <div className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={cn("h-6 px-2.5 text-[13px]", TURN_TONE[entry.nextTurn])}>
                  {NEXT_TURN_LABEL[entry.nextTurn]}
                </Badge>
                <span className="text-[13px]">
                  {entry.dueOn ? (
                    <>
                      기한 <span className="tabular-nums">{formatDate(entry.dueOn)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">기한 없음</span>
                  )}
                </span>
                {overdue ? (
                  <Badge className="bg-red-500/12 text-red-700 dark:bg-red-400/15 dark:text-red-300">
                    지남
                  </Badge>
                ) : null}
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                마지막 기록 <span className="tabular-nums">{formatDate(entry.date)}</span> ·{" "}
                <StaleDays days={daysBetween(entry.date, today)} />
                {entry.counterpart ? ` · 상대 ${entry.counterpart}` : ""}
              </p>
              {/* 메일 기록이면 메모가 왼쪽 메일 요약과 같은 글이다 — 두 번 보이지 않게 메일이 아닐 때만 */}
              {entry.note && entry.direction === null && entry.source !== "mail" ? (
                <p className="mt-2 text-[13px] leading-relaxed break-keep whitespace-pre-wrap">
                  {entry.note}
                </p>
              ) : null}

              {canWrite ? (
                editing ? (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3">
                    <div>
                      <span className="mb-1 block text-[12px] text-muted-foreground">다음 차례</span>
                      <div className="flex w-full overflow-hidden rounded-md border">
                        {NEXT_TURNS.map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTurn(t)}
                            className={cn(
                              "touch-target min-h-8 flex-1 px-2 text-[12.5px] font-medium transition-colors",
                              turn === t
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            )}
                          >
                            {NEXT_TURN_LABEL[t]}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[12px] text-muted-foreground">기한</label>
                      <Input
                        type="date"
                        value={due}
                        onChange={(e) => setDue(e.target.value)}
                        className="h-8 text-[13px]"
                      />
                    </div>

                    {error ? (
                      <p className="text-[12px] text-red-600 dark:text-red-400">{error}</p>
                    ) : null}

                    <div className="flex items-center gap-1.5">
                      <Button size="sm" disabled={busy || !dirty} onClick={() => void saveTurn()}>
                        {busy ? "저장 중…" : "저장"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setTurn(entry.nextTurn)
                          setDue(entry.dueOn ?? "")
                          setEditing(false)
                        }}
                      >
                        취소
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      차례·기한 바꾸기
                    </Button>
                    <span className="text-[12px] text-muted-foreground">
                      새 일이 생겼으면 위 「기록하기」로 남기세요.
                    </span>
                  </div>
                )
              ) : null}
            </div>
          </div>

          {/* ② 이 건의 등록 정보 — 확인용. 틀렸을 때만 「값 고치기」 */}
          <div>
            <h3 className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {isPatent ? "특허" : "상표"} 정보
            </h3>
            <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              {facts.map(([label, value, mono]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className={cn("min-w-0 break-keep whitespace-pre-wrap", mono && "font-mono text-[12.5px]")}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {empty.length > 0 ? (
              <p className="mt-2 text-[12px] text-muted-foreground">
                비어 있음 · {empty.join(" · ")}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {canWrite ? (
                <CorrectionForm
                  entityKind={kind}
                  entityId={entry.entityId}
                  stage={status}
                  today={today}
                  current={{
                    name,
                    holder,
                    appNo: row?.appNo ?? null,
                    regNo: row?.regNo ?? null,
                    filedOn: row?.filedOn ?? null,
                    registeredOn: row?.registeredOn ?? null,
                  }}
                  stageOptions={pipeline}
                  onSaved={refresh}
                />
              ) : (
                <span className="text-[12px] text-muted-foreground">
                  읽기 전용 계정이라 값을 고칠 수 없습니다.
                </span>
              )}
              <Link
                href={`/ip/register?kind=${kind}&focus=${entry.entityId}`}
                className="text-[12px] text-primary hover:underline"
              >
                IP 목록에서 이 건 보기
              </Link>
            </div>
          </div>
        </section>
        <section className="shrink-0 px-4 pb-4 md:min-h-0 md:shrink md:overflow-y-auto">
          <h3 className="z-10 mb-1.5 bg-popover py-1 md:sticky md:top-0 text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
            주고받은 메일 {mails.length}건
          </h3>
          <MailThread items={mails} />
        </section>

      </div>
    </>
  )
}
