"use client"

import { useState, useMemo, useRef, useEffect, useTransition, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PlusSignIcon,
  Delete02Icon,
  Tick02Icon,
  ArrowRight02Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { EntityPicker, type PickerOption } from "./entity-picker"
import { quoteTotals, won, ORG_TYPE_LABEL } from "@/lib/crm"
import type { CrmOrgType } from "@/generated/prisma"
import { cn } from "@/lib/utils"

interface OrgLite {
  id: string
  name: string
  type: CrmOrgType
  contacts: { id: string; name: string; title: string | null }[]
  membership: { id: string; discountAmount: number } | null
}
interface ProductLite {
  id: string
  name: string
  spec: string | null
  /** 시린지·바이알·세트… 이름을 통일한 뒤로는 이게 있어야 같은 이름끼리 갈린다 */
  kind: string | null
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
 * 한 번에 하나씩 묻는다.
 *
 * 앞의 답이 정해져야 다음 칸이 나타난다 — 기관을 골라야 담당자가 뜨고, 담당자가
 * 정해져야 품목이 뜬다. 처음부터 빈 칸 여섯 개를 늘어놓으면 어디부터 손대야 할지,
 * 무엇이 필수인지 사람이 판단해야 한다. 순서를 화면이 알고 있으면 그럴 필요가 없다.
 *
 * 채운 칸은 그대로 남아 계속 고칠 수 있다. 되돌아갈 수 없는 마법사가 아니다.
 */
function Step({
  show = true,
  label,
  hint,
  children,
  autoFocus,
}: {
  show?: boolean
  label: string
  hint?: ReactNode
  children: ReactNode
  autoFocus?: boolean
}) {
  // 라벨 줄이 아니라 **입력 영역**만 본다. 「건너뛰기」 같은 보조 버튼이 라벨 옆에
  // 있어서, 단계 전체에서 첫 버튼을 찾으면 그쪽으로 커서가 간다.
  const bodyRef = useRef<HTMLDivElement>(null)
  const focused = useRef(false)

  useEffect(() => {
    if (!show || !autoFocus || focused.current) return
    focused.current = true
    const el = bodyRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled])"
    )
    const t = setTimeout(() => el?.focus(), 260)
    return () => clearTimeout(t)
  }, [show, autoFocus])

  if (!show) return null
  return (
    <div className="animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[12px] font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div ref={bodyRef}>{children}</div>
    </div>
  )
}

export function QuoteComposer({
  orgs: initialOrgs,
  products,
}: {
  orgs: OrgLite[]
  products: ProductLite[]
}) {
  const router = useRouter()
  const [orgs, setOrgs] = useState(initialOrgs)
  // 방금 만든 기관은 유형이 비어 있다. 그 자리에서 정할 수 있게 표시해 둔다.
  const [justCreatedOrgId, setJustCreatedOrgId] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [contactSkipped, setContactSkipped] = useState(false)
  const [quotedAt, setQuotedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [discount, setDiscount] = useState(0)
  const [discountTouched, setDiscountTouched] = useState(false)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()

  const org = orgs.find((o) => o.id === orgId) ?? null
  const filled = lines.filter((l) => l.productId)

  // 어디까지 왔는지는 따로 세지 않고 채워진 값에서 끌어낸다.
  // 카운터를 따로 두면 값과 단계가 어긋나는 순간이 생긴다.
  const showContact = Boolean(orgId)
  const showItems = showContact && (Boolean(contactId) || contactSkipped)
  const showFinish = showItems && filled.length > 0

  const orgOptions: PickerOption[] = orgs.map((o) => ({ id: o.id, label: o.name }))
  const contactOptions: PickerOption[] = (org?.contacts ?? []).map((c) => ({
    id: c.id,
    label: c.name,
    hint: c.title,
  }))
  // 애드젤은 이름이 같고 규격·형태로만 갈린다. 둘 다 보여 줘야 고를 수 있다.
  const productOptions: PickerOption[] = products.map((p) => ({
    id: p.id,
    label: p.name,
    hint: [p.spec, p.kind].filter(Boolean).join(" · ") || null,
    keywords: `${p.spec ?? ""} ${p.kind ?? ""}`,
  }))

  const totals = useMemo(
    () =>
      quoteTotals(
        filled.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice })),
        discount
      ),
    [filled, discount]
  )

  function pickOrg(id: string | null) {
    setOrgId(id)
    setJustCreatedOrgId((prev) => (prev === id ? prev : null))
    setContactId(null)
    setContactSkipped(false)
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
      setJustCreatedOrgId(data.id)
      toast.success(`기관 «${data.name}» 을 만들었어요`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
    } finally {
      setBusy(false)
    }
  }

  async function setOrgType(type: CrmOrgType) {
    if (!orgId) return
    setOrgs((prev) => prev.map((o) => (o.id === orgId ? { ...o, type } : o)))
    try {
      const res = await fetch(`/api/crm/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? "유형을 바꾸지 못했습니다")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
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

  function pickProduct(key: string, productId: string | null) {
    const p = products.find((x) => x.id === productId)
    setLine(key, { productId, unitPrice: p?.unitPrice ?? 0 })
  }

  const canSave = showFinish && !busy && !pending

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
    <div className="mx-auto w-full max-w-[560px] px-6 pb-24 pt-8">
      <h1 className="text-[20px] font-bold tracking-[-0.02em]">새 견적</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        하나씩 채우면 다음 칸이 나옵니다.
      </p>

      <div className="mt-7 flex flex-col gap-5">
        {/* 1 — 기관 */}
        <Step label="어느 기관인가요?">
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
          {justCreatedOrgId === orgId && org && (
            <div className="mt-2 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
              <p className="mb-1.5 text-[11px] text-muted-foreground">
                새 기관이라 유형이 비어 있어요. 골라 두면 목록에서 분류됩니다.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(ORG_TYPE_LABEL) as CrmOrgType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrgType(t)}
                    aria-pressed={org.type === t}
                    className={cn(
                      "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] transition-colors",
                      org.type === t
                        ? "border-primary/30 bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {ORG_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Step>

        {/* 2 — 담당자 */}
        <Step
          show={showContact}
          autoFocus
          label="담당자는 누구인가요?"
          hint={
            !contactId && !contactSkipped ? (
              <button
                type="button"
                onClick={() => setContactSkipped(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                모르면 건너뛰기
              </button>
            ) : null
          }
        >
          <EntityPicker
            options={contactOptions}
            value={contactId}
            onChange={(id) => {
              setContactId(id)
              if (id) setContactSkipped(false)
            }}
            placeholder="담당자 이름으로 찾기"
            emptyLabel={contactSkipped ? "담당자 없이 진행합니다" : "담당자를 고르세요"}
            onCreate={createContact}
            createLabel="담당자로 새로 만들기"
            disabled={busy}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            직함은 따로 저장돼요. 「김광민 교수님」처럼 붙여 쓰지 않아도 됩니다.
          </p>
        </Step>

        {/* 3 — 품목 */}
        <Step show={showItems} autoFocus label="무엇을 얼마나 보내나요?">
          <div className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={l.key}>
                <div className="grid grid-cols-[1fr_64px_auto] items-center gap-2">
                  <EntityPicker
                    options={productOptions}
                    value={l.productId}
                    onChange={(id) => pickProduct(l.key, id)}
                    placeholder="제품 이름 · 규격으로 찾기"
                    emptyLabel="제품을 고르세요"
                  />
                  <Input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      setLine(l.key, { quantity: Math.max(1, Number(e.target.value) || 1) })
                    }
                    aria-label={`${i + 1}번째 품목 수량`}
                    className={cn("text-right", !l.productId && "invisible")}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="이 품목 지우기"
                    className={cn(lines.length === 1 && "invisible")}
                    onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={15} aria-hidden />
                  </Button>
                </div>

                {/* 단가는 제품을 고른 뒤에만 의미가 있다 */}
                {l.productId && (
                  <div className="mt-1.5 flex items-center justify-end gap-2 pr-10 text-[12px] text-muted-foreground animate-in fade-in-0 duration-150 motion-reduce:animate-none">
                    <span>단가</span>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={l.unitPrice}
                      onChange={(e) =>
                        setLine(l.key, { unitPrice: Math.max(0, Number(e.target.value) || 0) })
                      }
                      aria-label={`${i + 1}번째 품목 단가`}
                      className="h-8 w-[130px] text-right font-mono"
                    />
                    <span className="w-[110px] text-right font-mono text-foreground">
                      {won(l.quantity * l.unitPrice)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>

          {filled.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setLines((p) => [...p, newLine()])}
              className="mt-2 gap-1"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={13} aria-hidden />
              품목 추가
            </Button>
          )}
        </Step>

        {/* 4 — 마무리 */}
        <Step show={showFinish} label="이대로 맞나요?">
          <div className="rounded-xl border bg-card p-4">
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
                HRP 회원이라 {won(org.membership.discountAmount)} 을 채워 뒀어요. 실제로
                깎지 않을 거면 0 으로 바꾸세요.
              </p>
            )}

            <div className="mt-4 grid gap-3 border-t pt-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="quote-date"
                  className="mb-1.5 block text-[12px] text-muted-foreground"
                >
                  견적일자
                </label>
                <Input
                  id="quote-date"
                  type="date"
                  value={quotedAt}
                  onChange={(e) => setQuotedAt(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="quote-note"
                  className="mb-1.5 block text-[12px] text-muted-foreground"
                >
                  비고 (선택)
                </label>
                <Textarea
                  id="quote-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={1}
                  placeholder="샘플 동봉 예정 등"
                />
              </div>
            </div>
          </div>

          <Button
            onClick={save}
            disabled={!canSave}
            size="lg"
            className="mt-4 w-full gap-1.5"
          >
            {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
            견적 만들기
          </Button>
        </Step>

        {/* 아직 못 간 자리에 무엇이 남았는지만 알려 준다 */}
        {!showFinish && (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={ArrowRight02Icon} size={13} aria-hidden />
            {!showContact
              ? "기관을 고르면 다음 칸이 나옵니다"
              : !showItems
                ? "담당자를 고르거나 건너뛰면 품목 칸이 나옵니다"
                : "제품을 고르면 금액이 계산됩니다"}
          </p>
        )}
      </div>
    </div>
  )
}
