"use client"

import { useState, useMemo, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Delete02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { EntityPicker, type PickerOption } from "./entity-picker"
import { quoteTotals, won } from "@/lib/crm"

interface OrgLite {
  id: string
  name: string
  contacts: { id: string; name: string; title: string | null }[]
  membership: { id: string; discountAmount: number } | null
}
interface ProductLite {
  id: string
  name: string
  spec: string | null
  unitPrice: number | null
}
interface Line {
  key: string
  productId: string | null
  quantity: number
  unitPrice: number
}

const newLine = (): Line => ({
  key: Math.random().toString(36).slice(2),
  productId: null,
  quantity: 1,
  unitPrice: 0,
})

/**
 * 견적 한 장을 쓴다.
 *
 * 엑셀에서는 새 거래처면 기관마스터 → 컨택포인트 → HRP 시트를 먼저 돌고 와야
 * 견적의 드롭다운에 이름이 떴다. 여기서는 그 순서를 없앤다 — 없는 기관·담당자는
 * 고르는 자리에서 바로 만든다. 화면을 떠나지 않는다.
 */
export function QuoteComposer({
  orgs: initialOrgs,
  products,
}: {
  orgs: OrgLite[]
  products: ProductLite[]
}) {
  const router = useRouter()
  const [orgs, setOrgs] = useState(initialOrgs)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [quotedAt, setQuotedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [discount, setDiscount] = useState(0)
  const [discountTouched, setDiscountTouched] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()

  const org = orgs.find((o) => o.id === orgId) ?? null

  const orgOptions: PickerOption[] = orgs.map((o) => ({ id: o.id, label: o.name }))
  const contactOptions: PickerOption[] = (org?.contacts ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.title,
  }))
  const productOptions: PickerOption[] = products.map((p) => ({
    id: p.id,
    label: p.name,
    hint: p.spec,
    keywords: p.spec ?? "",
  }))

  const totals = useMemo(
    () =>
      quoteTotals(
        lines.filter((l) => l.productId).map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
        discount
      ),
    [lines, discount]
  )

  /** HRP 회원이면 할인을 **제안**한다. 사람이 손대면 그 뒤로는 건드리지 않는다. */
  function pickOrg(id: string | null) {
    setOrgId(id)
    setContactId(null)
    if (!discountTouched) {
      const m = orgs.find((o) => o.id === id)?.membership
      setDiscount(m?.discountAmount ?? 0)
    }
  }

  async function createOrg(name: string) {
    setBusy(true)
    try {
      const res = await fetch("/api/crm/orgs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "기관을 만들지 못했습니다")
      setOrgs((prev) => [...prev, { ...data, contacts: [], membership: null }])
      pickOrg(data.id)
      toast.success(`기관 «${data.name}» 을 만들었어요`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(false)
    }
  }

  async function createContact(name: string) {
    if (!orgId) return
    setBusy(true)
    try {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "담당자를 만들지 못했습니다")
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === orgId
            ? { ...o, contacts: [...o.contacts, { id: data.id, name: data.name, title: data.title }] }
            : o
        )
      )
      setContactId(data.id)
      toast.success(`담당자 «${data.name}» 을 만들었어요`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(false)
    }
  }

  function setLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  /** 제품을 고르면 기준 단가를 **복사**한다. 이후 이 견적의 단가는 제품과 무관하다. */
  function pickProduct(key: string, productId: string | null) {
    const p = products.find((x) => x.id === productId)
    setLine(key, { productId, unitPrice: p?.unitPrice ?? 0 })
  }

  const filled = lines.filter((l) => l.productId)
  const canSave = Boolean(orgId) && filled.length > 0 && !busy && !pending

  function save() {
    if (!canSave) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quotedAt,
            orgId,
            contactId,
            membershipId: org?.membership?.id ?? null,
            discountAmount: totals.discount,
            status: "DRAFT",
            note: note || null,
            items: filled.map((l) => ({
              productId: l.productId,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
            })),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "견적을 저장하지 못했습니다")
        toast.success(`견적 ${data.code} 을 만들었어요`)
        router.push(`/crm/quotes/${data.id}`)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-[860px] px-6 pb-24 pt-6">
      <h1 className="mb-5 text-[18px] font-bold tracking-[-0.02em]">새 견적</h1>

      {/* 받는 곳 */}
      <section className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          받는 곳
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-[12px]">기관</Label>
            <EntityPicker
              options={orgOptions}
              value={orgId}
              onChange={pickOrg}
              placeholder="기관 이름으로 찾기"
              emptyLabel="기관을 고르세요"
              onCreate={createOrg}
              createLabel="기관으로 새로 만들기"
              disabled={busy}
            />
          </div>
          <div>
            <Label className="mb-1.5 block text-[12px]">견적일자</Label>
            <Input
              type="date"
              value={quotedAt}
              onChange={(e) => setQuotedAt(e.target.value)}
              aria-label="견적일자"
            />
          </div>
          <div className="sm:col-span-3">
            <Label className="mb-1.5 block text-[12px]">담당자</Label>
            <EntityPicker
              options={contactOptions}
              value={contactId}
              onChange={setContactId}
              placeholder={org ? "담당자 이름으로 찾기" : "기관을 먼저 고르세요"}
              emptyLabel={org ? "담당자를 고르세요 (선택)" : "기관을 먼저 고르세요"}
              onCreate={org ? createContact : undefined}
              createLabel="담당자로 새로 만들기"
              disabled={!org || busy}
            />
            {org && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                직함은 이름과 따로 저장돼요. 「김광민 교수님」처럼 붙여 쓰지 않아도 됩니다.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* 품목 */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            품목
          </h2>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setLines((p) => [...p, newLine()])}
            className="gap-1"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
            품목 추가
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((l) => (
            <div key={l.key} className="grid grid-cols-[1fr_72px_120px_auto] items-end gap-2">
              <div>
                <EntityPicker
                  options={productOptions}
                  value={l.productId}
                  onChange={(id) => pickProduct(l.key, id)}
                  placeholder="제품 이름 · 규격으로 찾기"
                  emptyLabel="제품을 고르세요"
                />
              </div>
              <div>
                <Input
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setLine(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                  aria-label="수량"
                  className="text-right"
                />
              </div>
              <div>
                <Input
                  type="number"
                  min={0}
                  step={1000}
                  value={l.unitPrice}
                  onChange={(e) => setLine(l.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })}
                  aria-label="단가"
                  className="text-right"
                />
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="이 품목 지우기"
                disabled={lines.length === 1}
                onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
              >
                <HugeiconsIcon icon={Delete02Icon} size={15} aria-hidden />
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          단가는 제품을 고르면 기준값이 들어오고, 이 견적 안에서만 바뀝니다. 나중에 제품
          단가를 고쳐도 이 견적 금액은 그대로예요.
        </p>
      </section>

      {/* 금액 */}
      <section className="mt-4 rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          금액
        </h2>
        <dl className="flex flex-col gap-1.5 text-[13px]">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">공급가</dt>
            <dd className="font-mono">{won(totals.supply)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">
              할인
              {org?.membership && (
                <span className="ml-1.5 text-[11px] text-primary">HRP 회원</span>
              )}
            </dt>
            <dd>
              <Input
                type="number"
                min={0}
                step={10000}
                value={discount}
                onChange={(e) => {
                  setDiscountTouched(true)
                  setDiscount(Math.max(0, Number(e.target.value) || 0))
                }}
                aria-label="할인액"
                className="h-8 w-[130px] text-right font-mono"
              />
            </dd>
          </div>
          <div className="flex justify-between border-t pt-1.5">
            <dt className="text-muted-foreground">소계</dt>
            <dd className="font-mono">{won(totals.subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">부가세 10%</dt>
            <dd className="font-mono">{won(totals.vat)}</dd>
          </div>
          <div className="flex justify-between border-t pt-2 text-[15px] font-bold">
            <dt>실 합계</dt>
            <dd className="font-mono">{won(totals.total)}</dd>
          </div>
        </dl>
        {org?.membership && !discountTouched && discount > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            HRP 회원이라 {won(org.membership.discountAmount)} 을 채워 뒀어요. 실제로 깎지
            않을 거면 0 으로 바꾸세요 — 적어 둔 값이 그대로 합계에 반영됩니다.
          </p>
        )}
      </section>

      <section className="mt-4">
        <Label className="mb-1.5 block text-[12px]">비고</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="샘플 동봉 예정 등"
        />
      </section>

      <div className="mt-5 flex items-center justify-end gap-2">
        {!orgId && <span className="text-[12px] text-muted-foreground">기관을 골라야 저장할 수 있어요</span>}
        <Button onClick={save} disabled={!canSave} className="gap-1.5">
          {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={15} aria-hidden />}
          견적 만들기
        </Button>
      </div>
    </div>
  )
}
