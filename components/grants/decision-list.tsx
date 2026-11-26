"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { send } from "@/components/grants/send"
import {
  InlineField,
  useFieldSaver,
  type EditorProps,
} from "@/components/grants/inline-field"
import {
  GrantFiles,
  type AttachmentView,
} from "@/components/grants/grant-files"
import { NasFolderPicker } from "@/components/grants/nas-folder-picker"
import {
  GRANT_STAGES,
  GRANT_STAGE_FIELD_LABEL,
  GRANT_STAGE_LABEL,
  seoulYmd,
  stageFieldShown,
  won,
  type GrantStage,
} from "@/lib/grants-labels"

import { sameSet, sameText } from "@/lib/inline-field"
import { cn } from "@/lib/utils"

export interface DecisionView {
  id: string
  title: string
  stage: GrantStage
  stageReason: string | null
  statusRaw: string | null
  submittedTitle: string | null
  note: string | null
  deadline: string | null
  amount: string | null
  owners: { id: string; name: string; role: string | null }[]
  task: { id: string; slug: string; name: string } | null
  project: { id: string; name: string } | null
  noticeLinks: {
    relation: string | null
    title: string
    date: string | null
    key: string | null
  }[]
  nasFolder: string | null
  /** 상태별 칸 — 날짜는 ISO, 확정 지원금은 원 단위 숫자 문자열 */
  selectedOn: string | null
  awardedAmount: string | null
  agreementOn: string | null
  startsOn: string | null
  endsOn: string | null
  completedOn: string | null
  /** 노션에서 옮겨 온 결정 — 내리지 않고 단계를 중단으로 바꾼다 */
  imported: boolean
  /** 이 결정 · 같은 사업 공고의 첨부 */
  attachments: AttachmentView[]
}

type Opt = { id: string; name: string }

export const STAGE_CHIP: Record<GrantStage, string> = {
  PREPARING: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  SUBMITTED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  SELECTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  IN_PROGRESS: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  COMPLETED: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  STOPPED: "bg-muted text-muted-foreground",
}

const RELATION_LABEL: Record<string, string> = {
  same: "같은 공고",
  related: "관련",
  other_round: "다른 회차",
  unsure: "확인 필요",
}

/** 남은 날 — 오늘 0, 지난 마감은 음수 */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null
  const today = seoulYmd(new Date())!
  return Math.round(
    (new Date(`${seoulYmd(iso)}T00:00:00+09:00`).getTime() -
      new Date(`${today}T00:00:00+09:00`).getTime()) /
      86_400_000
  )
}

export function DecisionList({
  rows,
  members,
  tasks,
  projects,
}: {
  rows: DecisionView[]
  members: Opt[]
  tasks: (Opt & { slug: string })[]
  projects: Opt[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (rows.length === 0) {
    return (
      <p className="glass rounded-2xl p-4 text-[13px] text-muted-foreground">
        과제가 없습니다.
      </p>
    )
  }
  return (
    <ul className="glass divide-y divide-[var(--glass-edge)] overflow-hidden rounded-2xl">
      {rows.map((r) => (
        <DecisionRow
          key={r.id}
          r={r}
          open={open === r.id}
          onToggle={() => setOpen(open === r.id ? null : r.id)}
          members={members}
          tasks={tasks}
          projects={projects}
        />
      ))}
    </ul>
  )
}

function DecisionRow({
  r,
  open,
  onToggle,
  members,
  tasks,
  projects,
}: {
  r: DecisionView
  open: boolean
  onToggle: () => void
  members: Opt[]
  tasks: (Opt & { slug: string })[]
  projects: Opt[]
}) {
  const left = daysLeft(r.deadline)
  // 수행 중 · 완료는 마감 대신 수행 종료일 · 완료일을 짧게
  const due =
    r.stage === "IN_PROGRESS"
      ? r.endsOn
        ? `~ ${seoulYmd(r.endsOn)}`
        : null
      : r.stage === "COMPLETED"
        ? r.completedOn
          ? `완료 ${seoulYmd(r.completedOn)}`
          : null
        : dueText(r.deadline)

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${r.title} ${open ? "접기" : "펼치기"}`}
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <StageChip stage={r.stage} />
            <span className="truncate text-[13.5px] font-semibold">
              {r.title}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
            {due && (
              <span
                className={cn(
                  r.stage !== "IN_PROGRESS" &&
                    r.stage !== "COMPLETED" &&
                    left !== null &&
                    left >= 0 &&
                    left <= 7 &&
                    "font-medium text-foreground"
                )}
              >
                {due}
              </span>
            )}
            <span>
              {r.owners.length
                ? r.owners.map((o) => o.name).join("·")
                : "담당 없음"}
            </span>
            {r.noticeLinks.length > 0 && (
              <span>공고 {r.noticeLinks.length}</span>
            )}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform group-hover:text-foreground",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <DecisionDetail
          r={r}
          members={members}
          tasks={tasks}
          projects={projects}
        />
      )}
    </li>
  )
}

function StageChip({ stage }: { stage: GrantStage }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium",
        STAGE_CHIP[stage]
      )}
    >
      {GRANT_STAGE_LABEL[stage]}
    </span>
  )
}

function dueText(iso: string | null): string | null {
  if (!iso) return null
  const left = daysLeft(iso)!
  return left < 0
    ? `마감 ${seoulYmd(iso)}`
    : left === 0
      ? `오늘 마감 · ${seoulYmd(iso)}`
      : `D-${left} · ${seoulYmd(iso)}`
}

const text = (v: string) => v.trim() || null
const focusOnMount = (el: HTMLElement | null) => el?.focus()

/** 펼친 결정 — 보이는 칸을 그 자리에서 고친다. 칸 하나씩 PATCH(고치기 전 값을 expect 로) */
function DecisionDetail({
  r,
  members,
  tasks,
  projects,
}: {
  r: DecisionView
  members: Opt[]
  tasks: (Opt & { slug: string })[]
  projects: Opt[]
}) {
  const saver = useFieldSaver(`/api/grants/decisions/${r.id}`)
  const [removing, setRemoving] = useState(false)
  // 지금 담당인데 재직 목록에 없는 사람도 칩으로 남긴다
  const people = [
    ...members,
    ...r.owners.filter((o) => !members.some((m) => m.id === o.id)),
  ]
  const name = new Map(people.map((p) => [p.id, p.name]))
  const taskOpts =
    r.task && !tasks.some((t) => t.id === r.task!.id)
      ? [r.task, ...tasks]
      : tasks
  const taskOf = new Map(taskOpts.map((t) => [t.id, t]))
  const projectOpts =
    r.project && !projects.some((p) => p.id === r.project!.id)
      ? [r.project, ...projects]
      : projects
  const projectOf = new Map(projectOpts.map((p) => [p.id, p.name]))

  return (
    <div className="px-3 pb-3">
      <div className="relative rounded-xl bg-background/50 p-3 text-[12px]">
        {!r.imported && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`${r.title} 더보기`}
              className="touch-target absolute top-1.5 right-1.5 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
            >
              <HugeiconsIcon
                icon={MoreHorizontalIcon}
                size={16}
                strokeWidth={2}
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-36">
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setRemoving(true)}
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={14}
                  strokeWidth={2}
                  aria-hidden
                />
                내리기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <dl
          aria-label={`${r.title} 칸`}
          className={cn(
            "grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[84px_1fr]",
            !r.imported && "pr-8"
          )}
        >
          <InlineField<GrantStage>
            label="단계"
            value={r.stage}
            display={(v) => <StageChip stage={v} />}
            save={saver("stage")}
            editor={({ draft, commit, bind }) => (
              <NativeSelect
                {...bind()}
                size="sm"
                className="w-full sm:w-48"
                value={draft}
                onChange={(e) => commit(e.target.value as GrantStage)}
              >
                {GRANT_STAGES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {GRANT_STAGE_LABEL[s]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <InlineField<string>
            label="사유"
            value={r.stageReason ?? ""}
            equals={sameText}
            display={text}
            save={saver("stageReason")}
            editor={(p) => <TextEditor {...p} />}
          />
          <InlineField<string>
            label="마감"
            value={seoulYmd(r.deadline) ?? ""}
            display={(v) => (v ? dueText(v) : null)}
            save={saver("deadline")}
            editor={({ draft, setDraft, bind }) => (
              <Input
                {...bind()}
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-8 w-full text-[12px] sm:w-48 md:text-[12px]"
              />
            )}
          />
          <InlineField<string[]>
            label="담당"
            value={r.owners.map((o) => o.id)}
            equals={sameSet}
            display={(ids) =>
              ids.length ? ids.map((i) => name.get(i) ?? "?").join(" · ") : null
            }
            save={saver("ownerIds")}
            editor={({ draft, setDraft, bind }) => (
              <div
                {...bind()}
                // div 는 autoFocus 가 듣지 않는다 — 처음 그릴 때 한 번 포커스
                ref={focusOnMount}
                tabIndex={-1}
                role="group"
                className="flex flex-wrap gap-1.5 rounded-md py-0.5 outline-none"
              >
                {people.map((m) => {
                  const on = draft.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={on}
                      // 누를 때 포커스를 옮기지 않는다 — 칸을 벗어난 것으로 보고 저장하지 않게
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        setDraft(
                          on ? draft.filter((x) => x !== m.id) : [...draft, m.id]
                        )
                      }
                      className={cn(
                        "touch-target inline-flex h-7 cursor-pointer items-center rounded-full px-2.5 text-[12px] transition-colors",
                        on
                          ? "bg-foreground text-background"
                          : "glass text-foreground hover:bg-foreground/[0.04]"
                      )}
                    >
                      {m.name}
                    </button>
                  )
                })}
              </div>
            )}
          />
          <InlineField<string>
            label="지원금액"
            value={r.amount ?? ""}
            equals={sameText}
            display={text}
            save={saver("amount")}
            editor={(p) => <TextEditor {...p} />}
          />
          {(
            [
              "selectedOn",
              "awardedAmount",
              "agreementOn",
              "startsOn",
              "endsOn",
              "completedOn",
            ] as const
          )
            .filter((key) => stageFieldShown(key, r.stage, r[key] !== null))
            .map((key) =>
              key === "awardedAmount" ? (
                <InlineField<string>
                  key={key}
                  label={GRANT_STAGE_FIELD_LABEL[key]}
                  value={r.awardedAmount ?? ""}
                  display={(v) => (v ? won(Number(v)) : null)}
                  save={saver(key)}
                  editor={({ draft, setDraft, bind }) => (
                    <Input
                      {...bind()}
                      inputMode="numeric"
                      value={draft}
                      onChange={(e) =>
                        setDraft(e.target.value.replace(/[^\d]/g, ""))
                      }
                      className="h-8 w-full text-[12px] tabular-nums sm:w-48 md:text-[12px]"
                    />
                  )}
                />
              ) : (
                <InlineField<string>
                  key={key}
                  label={GRANT_STAGE_FIELD_LABEL[key]}
                  value={seoulYmd(r[key]) ?? ""}
                  display={(v) => v || null}
                  save={saver(key)}
                  editor={(p) => <DateEditor {...p} />}
                />
              )
            )}
          {r.statusRaw && <ReadOnly label="노션 상태" value={r.statusRaw} />}
          {r.submittedTitle && (
            <ReadOnly label="제출 과제명" value={r.submittedTitle} />
          )}
          <InlineField<string>
            label="신청 업무"
            value={r.task?.id ?? ""}
            display={(v) => {
              const t = taskOf.get(v)
              return t ? `#${t.slug} ${t.name}` : null
            }}
            after={
              r.task && (
                <Link
                  href={`/tasks/${r.task.id}`}
                  aria-label={`#${r.task.slug} 업무 열기`}
                  className="touch-target flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <HugeiconsIcon
                    icon={ArrowUpRight01Icon}
                    size={14}
                    strokeWidth={2}
                    aria-hidden
                  />
                </Link>
              )
            }
            save={saver("taskId")}
            editor={({ draft, commit, bind }) => (
              <NativeSelect
                {...bind()}
                size="sm"
                className="w-full"
                value={draft}
                onChange={(e) => commit(e.target.value)}
              >
                <NativeSelectOption value="">없음</NativeSelectOption>
                {taskOpts.map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    #{t.slug} {t.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <InlineField<string>
            label="과제 프로젝트"
            value={r.project?.id ?? ""}
            display={(v) => projectOf.get(v) ?? null}
            save={saver("projectId")}
            editor={({ draft, commit, bind }) => (
              <NativeSelect
                {...bind()}
                size="sm"
                className="w-full"
                value={draft}
                onChange={(e) => commit(e.target.value)}
              >
                <NativeSelectOption value="">없음</NativeSelectOption>
                {projectOpts.map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          />
          <InlineField<string>
            label="NAS 폴더"
            value={r.nasFolder ?? ""}
            display={(v) => (v ? v.split("/").pop() : null)}
            save={saver("nasFolder")}
            editor={({ id, draft, commit, bind }) => {
              const { id: _id, ...selectProps } = bind()
              void _id
              return (
                <NasFolderPicker
                  id={id}
                  value={draft}
                  title={r.title}
                  extraTitles={r.noticeLinks.map((l) => l.title)}
                  onChange={(v) => commit(v)}
                  selectProps={selectProps}
                />
              )
            }}
          />
          <InlineField<string>
            label="메모"
            value={r.note ?? ""}
            equals={sameText}
            display={text}
            save={saver("note")}
            editor={(p) => <TextEditor {...p} multiline />}
          />
        </dl>
      </div>
      {r.noticeLinks.length > 0 && (
        <ul className="mt-2 space-y-1 text-[12px]">
          {r.noticeLinks.map((l, i) => (
            <li key={i} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground">
                {RELATION_LABEL[l.relation ?? ""] ?? "공고"}
              </span>
              <span>{l.title}</span>
              {l.date && (
                <span className="text-muted-foreground tabular-nums">
                  {l.date}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <GrantFiles attachments={r.attachments} nasFolder={r.nasFolder} />
      {!r.imported && (
        <RemoveDecision r={r} open={removing} onOpenChange={setRemoving} />
      )}
    </div>
  )
}

function DateEditor({ draft, setDraft, bind }: EditorProps<string>) {
  return (
    <Input
      {...bind()}
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="h-8 w-full text-[12px] sm:w-48 md:text-[12px]"
    />
  )
}

function TextEditor({
  draft,
  setDraft,
  bind,
  multiline = false,
}: EditorProps<string> & { multiline?: boolean }) {
  return multiline ? (
    <Textarea
      {...bind({ multiline: true })}
      rows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="min-h-16 text-[12px] md:text-[12px]"
    />
  ) : (
    <Input
      {...bind()}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="h-8 text-[12px] md:text-[12px]"
    />
  )
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="pt-1 text-muted-foreground">{label}</dt>
      <dd className="py-1 break-words whitespace-pre-line">{value}</dd>
    </div>
  )
}

/** 과제 후보에서 올린 결정 내리기 — 되돌릴 수 없어 확인 창을 한 번 거친다 */
function RemoveDecision({
  r,
  open,
  onOpenChange: setOpen,
}: {
  r: DecisionView
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    try {
      await send(`/api/grants/decisions/${r.id}`, "DELETE")
      toast.success(`${r.title} · 우리 결정에서 내렸습니다`)
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "내리지 못했습니다")
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>우리 결정에서 내릴까요?</AlertDialogTitle>
          <AlertDialogDescription>
            {r.title} — 되돌릴 수 없습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1 text-[13px] break-keep text-muted-foreground">
          <li className="flex gap-1.5">
            <span aria-hidden>·</span>
            <span>담당 · 메모도 함께 지워집니다</span>
          </li>
          <li className="flex gap-1.5">
            <span aria-hidden>·</span>
            <span>과제 후보에는 다시 「올리기」 로 남습니다</span>
          </li>
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>그만두기</AlertDialogCancel>
          <AlertDialogAction
            onClick={remove}
            disabled={busy}
            className="gap-1.5 bg-destructive/10 text-destructive hover:bg-destructive/20"
          >
            {busy && <Spinner />}
            내리기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
