"use client"

import { useState, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  Delete02Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { send } from "@/components/grants/send"
import {
  GrantFiles,
  type AttachmentView,
} from "@/components/grants/grant-files"
import { NasFolderPicker } from "@/components/grants/nas-folder-picker"
import { GRANT_STAGES, GRANT_STAGE_LABEL, seoulYmd } from "@/lib/grants-labels"
import type { GrantStage } from "@/generated/prisma/client"
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
  /** 노션에서 옮겨 온 결정 — 내리지 않고 단계를 불참으로 바꾼다 */
  imported: boolean
  /** 이 결정 · 같은 사업 공고의 첨부 */
  attachments: AttachmentView[]
}

type Opt = { id: string; name: string }

export const STAGE_CHIP: Record<GrantStage, string> = {
  REVIEW: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  PREPARING: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  SUBMITTED: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  SELECTED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  DROPPED: "bg-muted text-muted-foreground",
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
  const [editing, setEditing] = useState(false)
  const left = daysLeft(r.deadline)
  const due =
    r.deadline === null
      ? null
      : left! < 0
        ? `마감 ${seoulYmd(r.deadline)}`
        : left === 0
          ? "오늘 마감"
          : `D-${left} · ${seoulYmd(r.deadline)}`
  const detail: [string, React.ReactNode][] = [
    ["사유", r.stageReason],
    ["노션 상태", r.statusRaw],
    ["제출 과제명", r.submittedTitle],
    ["지원금액", r.amount],
    ["메모", r.note],
    [
      "신청 업무",
      r.task && (
        <Link href={`/tasks/${r.task.id}`} className="hover:underline">
          #{r.task.slug} {r.task.name}
        </Link>
      ),
    ],
    ["과제 프로젝트", r.project?.name],
  ]

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
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium",
                STAGE_CHIP[r.stage]
              )}
            >
              {GRANT_STAGE_LABEL[r.stage]}
            </span>
            <span className="truncate text-[13.5px] font-semibold">
              {r.title}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted-foreground">
            {due && (
              <span
                className={cn(
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
        <div className="px-3 pb-3">
          {detail.some(([, v]) => v) && (
            <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-xl bg-background/50 p-3 text-[12px] sm:grid-cols-[84px_1fr]">
              {detail
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words whitespace-pre-line">{v}</dd>
                  </div>
                ))}
            </dl>
          )}
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
          {editing ? (
            <DecisionEditor
              r={r}
              members={members}
              tasks={tasks}
              projects={projects}
              onDone={() => setEditing(false)}
            />
          ) : (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="glass h-8 rounded-full px-3"
                onClick={() => setEditing(true)}
              >
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
                고치기
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function DecisionEditor({
  r,
  members,
  tasks,
  projects,
  onDone,
}: {
  r: DecisionView
  members: Opt[]
  tasks: (Opt & { slug: string })[]
  projects: Opt[]
  onDone: () => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    stage: r.stage,
    stageReason: r.stageReason ?? "",
    deadline: seoulYmd(r.deadline) ?? "",
    note: r.note ?? "",
    ownerIds: r.owners.map((o) => o.id),
    taskId: r.task?.id ?? "",
    projectId: r.project?.id ?? "",
    nasFolder: r.nasFolder ?? "",
  })
  // 지금 담당인데 재직 목록에 없는 사람도 칩으로 남긴다
  const people = [
    ...members,
    ...r.owners.filter((o) => !members.some((m) => m.id === o.id)),
  ]
  const taskOpts =
    r.task && !tasks.some((t) => t.id === r.task!.id)
      ? [r.task, ...tasks]
      : tasks

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      // NAS 폴더는 바꿨을 때만 보낸다 — 보내면 「사람이 정한 것」 으로 남아 이식이 다시 채우지 않는다
      const { nasFolder, ...rest } = form
      const body = nasFolder === (r.nasFolder ?? "") ? rest : form
      const res = await send(`/api/grants/decisions/${r.id}`, "PATCH", body)
      toast.success(`${r.title} · ${res.changed?.join(" · ") ?? "저장"}`)
      onDone()
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  const id = (k: string) => `gd-${r.id}-${k}`
  return (
    <form
      onSubmit={submit}
      aria-label={`${r.title} 고치기`}
      className="mt-2 grid grid-cols-1 gap-2.5 rounded-xl bg-background/60 p-3 sm:grid-cols-2"
    >
      <div>
        <Label htmlFor={id("stage")} className="mb-1 block text-[12px]">
          단계
        </Label>
        <NativeSelect
          id={id("stage")}
          className="w-full"
          value={form.stage}
          onChange={(e) =>
            setForm({ ...form, stage: e.target.value as GrantStage })
          }
        >
          {GRANT_STAGES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {GRANT_STAGE_LABEL[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor={id("deadline")} className="mb-1 block text-[12px]">
          마감
        </Label>
        <Input
          id={id("deadline")}
          type="date"
          value={form.deadline}
          onChange={(e) => setForm({ ...form, deadline: e.target.value })}
        />
      </div>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-[12px] font-medium">담당</legend>
        <div className="flex flex-wrap gap-1.5">
          {people.map((m) => {
            const on = form.ownerIds.includes(m.id)
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setForm({
                    ...form,
                    ownerIds: on
                      ? form.ownerIds.filter((x) => x !== m.id)
                      : [...form.ownerIds, m.id],
                  })
                }
                className={cn(
                  "touch-target inline-flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] transition-colors",
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
      </fieldset>
      <div className="sm:col-span-2">
        <Label htmlFor={id("reason")} className="mb-1 block text-[12px]">
          사유
        </Label>
        <Input
          id={id("reason")}
          value={form.stageReason}
          onChange={(e) => setForm({ ...form, stageReason: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id("task")} className="mb-1 block text-[12px]">
          신청 업무
        </Label>
        <NativeSelect
          id={id("task")}
          className="w-full"
          value={form.taskId}
          onChange={(e) => setForm({ ...form, taskId: e.target.value })}
        >
          <NativeSelectOption value="">없음</NativeSelectOption>
          {taskOpts.map((t) => (
            <NativeSelectOption key={t.id} value={t.id}>
              #{t.slug} {t.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor={id("project")} className="mb-1 block text-[12px]">
          과제 프로젝트
        </Label>
        <NativeSelect
          id={id("project")}
          className="w-full"
          value={form.projectId}
          onChange={(e) => setForm({ ...form, projectId: e.target.value })}
        >
          <NativeSelectOption value="">없음</NativeSelectOption>
          {projects.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={id("nas")} className="mb-1 block text-[12px]">
          NAS 폴더
        </Label>
        <NasFolderPicker
          id={id("nas")}
          value={form.nasFolder}
          title={r.title}
          extraTitles={r.noticeLinks.map((l) => l.title)}
          onChange={(nasFolder) => setForm({ ...form, nasFolder })}
        />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor={id("note")} className="mb-1 block text-[12px]">
          메모
        </Label>
        <Textarea
          id={id("note")}
          rows={3}
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        {!r.imported && (
          <RemoveDecision r={r} disabled={saving} className="mr-auto" />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={saving}
        >
          취소
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Spinner data-icon="inline-start" />}
          저장
        </Button>
      </div>
    </form>
  )
}

/** 과제 후보에서 올린 결정 내리기 — 되돌릴 수 없어 확인 창을 한 번 거친다 */
function RemoveDecision({
  r,
  disabled,
  className,
}: {
  r: DecisionView
  disabled: boolean
  className?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
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
      <AlertDialogTrigger
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn(
              "text-muted-foreground hover:text-destructive",
              className
            )}
          />
        }
      >
        <HugeiconsIcon
          icon={Delete02Icon}
          strokeWidth={2}
          data-icon="inline-start"
        />
        내리기
      </AlertDialogTrigger>
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
