"use client"

// 연혁 한 줄을 추가 · 수정 · 삭제하는 창 — 관리자에게만 보인다(2026-09-16).
// 회사 정보 · 재무 편집(company-editors.tsx)과 같은 방식이다: 창 하나, 저장하면 새로고침.
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import {
  EMPTY_RECORD_FORM,
  RECORD_FIELD_LABEL,
  RECORD_KINDS,
  RECORD_KIND_LABEL,
  RECORD_STATUSES,
  type RecordForm,
} from "@/lib/schemas/company"

async function send(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json().catch(() => null)) as { error?: string; changed?: string[] } | null
  if (!res.ok) throw new Error(data?.error ?? "저장하지 못했습니다")
  return data
}

function Field({ id, label, hint, wide, children }: { id: string; label: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label htmlFor={id} className="mb-1 block text-[12px]">
        {label}
      </Label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** 종류마다 쓰는 칸이 다르다 — 지원사업에 상격을, 수상에 과제번호를 묻지 않는다 */
const EXTRA_FIELDS: Record<string, (keyof RecordForm)[]> = {
  GRANT: ["subject", "grantNo", "fundingKrw", "ownCashKrw", "ownInKindKrw", "role", "partner"],
  AWARD: ["prize", "subject"],
  EXHIBITION: ["venue", "partner"],
  FORUM: ["venue"],
  EDUCATION: ["venue"],
  NETWORKING: ["venue"],
  INTERNAL: ["venue"],
  MILESTONE: ["venue"],
}

const MONEY_KEYS: (keyof RecordForm)[] = ["fundingKrw", "ownCashKrw", "ownInKindKrw"]

export function RecordDialog({ initial, trigger }: { initial: RecordForm; trigger?: ReactNode }) {
  const router = useRouter()
  const editing = !!initial.id
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof RecordForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  function close(next: boolean) {
    setOpen(next)
    if (!next) setForm(initial) // 닫으면 손대던 값을 되돌린다 — 다음에 열 때 옛 입력이 남지 않게
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const { id, ...body } = form
      const r = editing
        ? await send(`/api/company/records/${id}`, "PATCH", body)
        : await send("/api/company/records", "POST", body)
      toast.success(editing ? (r?.changed?.length ? `${r.changed.join(" · ")} 고침` : "바뀐 칸이 없습니다") : "연혁을 남겼습니다")
      close(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장 실패")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`「${form.title}」 을 지울까요? 되돌릴 수 없습니다.`)) return
    setSaving(true)
    try {
      await send(`/api/company/records/${form.id}`, "DELETE")
      toast.success("연혁을 지웠습니다")
      close(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 실패")
    } finally {
      setSaving(false)
    }
  }

  const extras = EXTRA_FIELDS[form.kind] ?? []

  return (
    <Dialog open={open} onOpenChange={close}>
      {trigger ? (
        <span onClick={() => setOpen(true)}>{trigger}</span>
      ) : (
        <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => setOpen(true)}>
          연혁 추가
        </Button>
      )}
      <DialogContent className="max-h-[85vh] w-[calc(var(--app-vw)-2rem)] max-w-xl overflow-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "연혁 수정" : "연혁 추가"}</DialogTitle>
          <DialogDescription>
            날짜를 모르면 비워 두고 기간 표기에 원문을 적습니다 — 화면은 기간 표기를 그대로 보여 줍니다.
          </DialogDescription>
        </DialogHeader>

        <form id="record-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field id="rec-kind" label={RECORD_FIELD_LABEL.kind}>
            <select
              id="rec-kind"
              value={form.kind}
              onChange={set("kind")}
              className="h-9 w-full rounded-md border bg-background px-2 text-[13px]"
            >
              {RECORD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {RECORD_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field id="rec-status" label={RECORD_FIELD_LABEL.status} hint="완료 · 진행중 · 발표완료 · 계획">
            <Input id="rec-status" list="rec-status-options" value={form.status} onChange={set("status")} />
            <datalist id="rec-status-options">
              {RECORD_STATUSES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          <Field id="rec-title" label={RECORD_FIELD_LABEL.title} wide>
            <Input id="rec-title" required value={form.title} onChange={set("title")} />
          </Field>

          <Field id="rec-starts" label={RECORD_FIELD_LABEL.startsOn}>
            <Input id="rec-starts" type="date" value={form.startsOn} onChange={set("startsOn")} />
          </Field>
          <Field id="rec-ends" label={RECORD_FIELD_LABEL.endsOn}>
            <Input id="rec-ends" type="date" value={form.endsOn} onChange={set("endsOn")} />
          </Field>

          <Field id="rec-period" label={RECORD_FIELD_LABEL.periodRaw} hint="비우면 날짜로 만들어 넣습니다">
            <Input id="rec-period" value={form.periodRaw} onChange={set("periodRaw")} placeholder="2026.04.28~04.30" />
          </Field>
          <Field id="rec-organizer" label={RECORD_FIELD_LABEL.organizer}>
            <Input id="rec-organizer" value={form.organizer} onChange={set("organizer")} />
          </Field>

          {extras.map((k) => (
            <Field key={k} id={`rec-${k}`} label={RECORD_FIELD_LABEL[k as keyof typeof RECORD_FIELD_LABEL]} wide={k === "subject"}>
              <Input
                id={`rec-${k}`}
                value={form[k]}
                onChange={set(k)}
                inputMode={MONEY_KEYS.includes(k) ? "numeric" : undefined}
                placeholder={MONEY_KEYS.includes(k) ? "숫자 · 쉼표 가능" : undefined}
              />
            </Field>
          ))}

          <Field id="rec-note" label={RECORD_FIELD_LABEL.note} wide>
            <Textarea id="rec-note" rows={3} value={form.note} onChange={set("note")} />
          </Field>
        </form>

        <DialogFooter className="gap-2">
          {editing && (
            <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={remove} disabled={saving}>
              삭제
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={saving}>
            취소
          </Button>
          <Button type="submit" form="record-form" disabled={saving} className="gap-1.5">
            {saving && <Spinner className="h-3.5 w-3.5" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 목록 줄에 붙는 작은 「고치기」 — 관리자만 본다 */
export function RecordEditButton({ initial }: { initial: RecordForm }) {
  return (
    <RecordDialog
      initial={initial}
      trigger={
        <button
          type="button"
          className="touch-target rounded px-1.5 py-0.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`${initial.title} 고치기`}
        >
          고치기
        </button>
      }
    />
  )
}

export { EMPTY_RECORD_FORM }
