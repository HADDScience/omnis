"use client"

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
  EMPTY_YEAR_FORM,
  PROFILE_FIELD_LABEL,
  YEAR_MONEY_FIELDS,
  type ProfileForm,
  type YearForm,
  type YearMoneyKey,
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

const toNumber = (s: string) => {
  const n = s.replace(/[^\d-]/g, "")
  return /^-?\d+$/.test(n) ? Number(n) : null
}

// ─── 회사 기본정보 ─────────────────────────────────────────────

const PROFILE_FIELDS: { key: keyof ProfileForm; type?: "date"; hint?: string; wide?: boolean; required?: boolean }[] = [
  { key: "nameKo", required: true },
  { key: "nameEn" },
  { key: "bizRegNo", required: true, hint: "000-00-00000" },
  { key: "bizType", hint: "개인과세사업자 · 법인 — 세무사 확인 뒤 적는다" },
  { key: "corpRegNo", hint: "법인일 때만 · 000000-0000000" },
  { key: "industry" },
  { key: "industryCode" },
  { key: "foundedOn", type: "date" },
  { key: "homepage" },
  { key: "asOfDate", type: "date", hint: "이 정보를 확인한 날" },
  { key: "hqAddress", wide: true },
  { key: "labAddress", wide: true },
  { key: "partnerAddress", wide: true },
]

/** 회사 기본정보 편집 — 관리자만 보이는 버튼 + 창. 저장하면 바뀐 칸 이름이 활동 기록에 남는다 */
export function CompanyProfileDialog({ initial, exists }: { initial: ProfileForm; exists: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof ProfileForm) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await send("/api/company/profile", "PATCH", form)
      const n = r?.changed?.length ?? 0
      toast.success(n > 0 ? `회사 정보를 저장했습니다 · ${n}칸 바뀜` : "바뀐 칸이 없습니다")
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="touch-target"
        onClick={() => {
          setForm(initial)
          setOpen(true)
        }}
      >
        {exists ? "회사 정보 편집" : "회사 정보 입력"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>회사 정보 {exists ? "편집" : "입력"}</DialogTitle>
            <DialogDescription>지원서·과제 서식에 그대로 들어가는 값입니다. 저장하면 누가 어떤 칸을 고쳤는지 활동 기록에 남습니다.</DialogDescription>
          </DialogHeader>
          <form id="company-profile-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PROFILE_FIELDS.map((f) => (
              <Field key={f.key} id={`cp-${f.key}`} label={`${PROFILE_FIELD_LABEL[f.key]}${f.required ? " *" : ""}`} hint={f.hint} wide={f.wide}>
                <Input
                  id={`cp-${f.key}`}
                  type={f.type ?? "text"}
                  value={form[f.key]}
                  onChange={set(f.key)}
                  required={f.required}
                  disabled={saving}
                  className="text-base md:text-sm"
                />
              </Field>
            ))}
          </form>
          <DialogFooter>
            <Button variant="outline" className="touch-target" onClick={() => setOpen(false)} disabled={saving}>
              취소
            </Button>
            <Button type="submit" form="company-profile-form" className="touch-target gap-1.5" disabled={saving}>
              {saving && <Spinner />}
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── 연도별 재무 ──────────────────────────────────────────────

/** 연도별 재무 한 줄 추가 · 수정 · 삭제. initial 에 id 가 있으면 수정 */
export function CompanyYearDialog({ initial }: { initial?: YearForm }) {
  const editing = !!initial?.id
  const start = initial ?? EMPTY_YEAR_FORM
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<YearForm>(start)
  const [busy, setBusy] = useState<null | "save" | "delete">(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (k: keyof YearForm) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))
  const formatMoney = (k: YearMoneyKey) => () => {
    const n = toNumber(form[k])
    if (n !== null) setForm((f) => ({ ...f, [k]: n.toLocaleString("ko-KR") }))
  }

  // 제품 + 용역 이 매출과 다르면 알려만 준다 (결산서와 세금계산서 몇천 원 차이는 흔하다)
  const rev = toNumber(form.revenueKrw)
  const prod = toNumber(form.revenueProductKrw)
  const serv = toNumber(form.revenueServiceKrw)
  const splitGap = rev !== null && (prod !== null || serv !== null) ? rev - (prod ?? 0) - (serv ?? 0) : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy("save")
    try {
      if (editing) await send(`/api/company/years/${initial!.id}`, "PATCH", form)
      else await send("/api/company/years", "POST", form)
      toast.success(`${form.year}년 ${form.basis === "CONFIRMED" ? "확정" : "계획"} 재무를 저장했습니다`)
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setBusy("delete")
    try {
      await send(`/api/company/years/${initial!.id}`, "DELETE")
      toast.success(`${start.year}년 줄을 지웠습니다`)
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "지우지 못했습니다")
    } finally {
      setBusy(null)
      setConfirmDelete(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant={editing ? "ghost" : "outline"}
        className={editing ? "touch-target h-7 px-2 text-[11.5px]" : "touch-target"}
        aria-label={editing ? `${start.year}년 ${start.basis === "CONFIRMED" ? "확정" : "계획"} 재무 수정` : "연도별 재무 추가"}
        onClick={() => {
          setForm(start)
          setConfirmDelete(false)
          setOpen(true)
        }}
      >
        {editing ? "수정" : "연도 추가"}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `${start.year}년 재무 수정` : "연도별 재무 추가"}</DialogTitle>
            <DialogDescription>
              매출은 공급가액(부가세 제외). 확정 = 결산서, 계획 = 예상·추정. 잠정 매출은 세금계산서에서 세므로 여기 적지 않습니다.
            </DialogDescription>
          </DialogHeader>
          <form id="company-year-form" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field id="cy-year" label="연도 *">
              <Input id="cy-year" inputMode="numeric" value={form.year} onChange={set("year")} required disabled={!!busy} className="text-base md:text-sm" />
            </Field>
            <Field id="cy-basis" label="단계 *">
              <select
                id="cy-basis"
                value={form.basis}
                onChange={set("basis")}
                disabled={!!busy}
                className="h-9 w-full rounded-md border bg-transparent px-2.5 text-base outline-none focus-visible:border-ring md:text-sm"
              >
                <option value="CONFIRMED">확정 (결산서)</option>
                <option value="PLANNED">계획 (예상·추정)</option>
              </select>
            </Field>
            {YEAR_MONEY_FIELDS.map(([k, label]) => (
              <Field key={k} id={`cy-${k}`} label={`${label} (원)`}>
                <Input
                  id={`cy-${k}`}
                  inputMode="numeric"
                  value={form[k]}
                  onChange={set(k)}
                  onBlur={formatMoney(k)}
                  disabled={!!busy}
                  className="text-right text-base tabular-nums md:text-sm"
                />
              </Field>
            ))}
            {splitGap !== null && splitGap !== 0 && (
              <p className="text-[11.5px] text-amber-700 sm:col-span-2 dark:text-amber-400">
                제품 + 용역 합이 매출과 {Math.abs(splitGap).toLocaleString("ko-KR")}원 {splitGap > 0 ? "적습니다" : "많습니다"} — 틀린 것이 아니라면 비고에 이유를 적어 두세요
              </p>
            )}
            <Field id="cy-headcount" label="상시근로자 (명)">
              <Input id="cy-headcount" inputMode="numeric" value={form.headcount} onChange={set("headcount")} disabled={!!busy} className="text-base md:text-sm" />
            </Field>
            <Field id="cy-accountLabel" label="결산서 매출 계정" hint="상품매출 · 서비스수입 …">
              <Input id="cy-accountLabel" value={form.accountLabel} onChange={set("accountLabel")} disabled={!!busy} className="text-base md:text-sm" />
            </Field>
            <Field id="cy-asOfDate" label="기준일">
              <Input id="cy-asOfDate" type="date" value={form.asOfDate} onChange={set("asOfDate")} disabled={!!busy} className="text-base md:text-sm" />
            </Field>
            <Field id="cy-note" label="비고" wide>
              <Textarea id="cy-note" value={form.note} onChange={set("note")} disabled={!!busy} rows={2} className="text-base md:text-sm" />
            </Field>
          </form>
          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <Button
                variant={confirmDelete ? "destructive" : "ghost"}
                className="touch-target gap-1.5"
                onClick={remove}
                disabled={!!busy}
              >
                {busy === "delete" && <Spinner />}
                {confirmDelete ? "한 번 더 누르면 삭제" : "이 줄 삭제"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button variant="outline" className="touch-target" onClick={() => setOpen(false)} disabled={!!busy}>
                취소
              </Button>
              <Button type="submit" form="company-year-form" className="touch-target gap-1.5" disabled={!!busy}>
                {busy === "save" && <Spinner />}
                저장
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
