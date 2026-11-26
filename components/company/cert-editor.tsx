"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { PencilEdit02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { send } from "@/components/grants/send"
import { CERT_STATUSES, CERT_STATUS_LABEL, seoulYmd } from "@/lib/grants-labels"
import type { CertStatus } from "@/generated/prisma/client"

type Editable = {
  id: string
  name: string
  status: CertStatus
  note: string | null
  acquiredOn: Date | string | null
  validUntil: Date | string | null
}

/** 인증 한 줄 고치기 — 상태 · 취득일 · 유효기간 · 메모. 펼친 칸 아래에 붙는다 */
export function CertEditor({ cert }: { cert: Editable }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(() => initial(cert))

  if (!editing) {
    return (
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="glass h-8 rounded-full px-3"
          onClick={() => {
            setForm(initial(cert))
            setEditing(true)
          }}
        >
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            strokeWidth={2}
            data-icon="inline-start"
          />
          고치기
        </Button>
      </div>
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await send(
        `/api/company/certifications/${cert.id}`,
        "PATCH",
        form
      )
      toast.success(`${cert.name} · ${r.changed?.join(" · ") ?? "저장"}`)
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  const id = (k: string) => `cert-${cert.id}-${k}`
  return (
    <form
      onSubmit={submit}
      className="mt-2 grid grid-cols-1 gap-2.5 rounded-xl bg-background/60 p-3 sm:grid-cols-3"
      aria-label={`${cert.name} 고치기`}
    >
      <div>
        <Label htmlFor={id("status")} className="mb-1 block text-[12px]">
          상태
        </Label>
        <NativeSelect
          id={id("status")}
          className="w-full"
          value={form.status}
          onChange={(e) =>
            setForm({ ...form, status: e.target.value as CertStatus })
          }
        >
          {CERT_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {CERT_STATUS_LABEL[s]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor={id("acquired")} className="mb-1 block text-[12px]">
          취득일
        </Label>
        <Input
          id={id("acquired")}
          type="date"
          value={form.acquiredOn}
          onChange={(e) => setForm({ ...form, acquiredOn: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor={id("valid")} className="mb-1 block text-[12px]">
          유효기간
        </Label>
        <Input
          id={id("valid")}
          type="date"
          value={form.validUntil}
          onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
        />
      </div>
      <div className="sm:col-span-3">
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
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(false)}
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

function initial(c: Editable) {
  return {
    status: c.status,
    note: c.note ?? "",
    acquiredOn: seoulYmd(c.acquiredOn) ?? "",
    validUntil: seoulYmd(c.validUntil) ?? "",
  }
}
