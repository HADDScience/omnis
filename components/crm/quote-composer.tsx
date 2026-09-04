"use client"

import { useState, useMemo, useTransition } from "react"
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
import { Step } from "./step"
import { RecipientSteps } from "./recipient-steps"
import { useRecipient, type OrgLite } from "./use-recipient"
import { quoteTotals, won } from "@/lib/crm"
import { cn } from "@/lib/utils"

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

export function QuoteComposer({
  orgs: initialOrgs,
  products,
}: {
  orgs: OrgLite[]
  products: ProductLite[]
}) {
  const router = useRouter()
  const r = useRecipient(initialOrgs)
  const [quotedAt, setQuotedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [discount, setDiscount] = useState(0)
  const [discountTouched, setDiscountTouched] = useState(false)
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  const org = r.org
  const filled = lines.filter((l) => l.productId)

  // 어디까지 왔는지는 따로 세지 않고 채워진 값에서 끌어낸다.
  // 카운터를 따로 두면 값과 단계가 어긋나는 순간이 생긴다.
  const showItems = Boolean(r.orgId) && (Boolean(r.contactId) || r.contactSkipped)
  const showFinish = showItems && filled.length > 0

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

  /** HRP 회원이면 할인을 **제안**한다. 사람이 손대면 그 뒤로는 건드리지 않는다. */
  function onOrgPicked(orgId: string | null) {
    if (discountTouched) return
    const m = r.orgs.find((o) => o.id === orgId)?.membership
    setDiscount(m?.discountAmount ?? 0)
  }

  function setLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function pickProduct(key: string, productId: string | null) {
    const p = products.find((x) => x.id === productId)
    setLine(key, { productId, unitPrice: p?.unitPrice ?? 0 })
  }

  const canSave = showFinish && !r.busy && !pending

  function save() {
    if (!canSave) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            quotedAt,
            orgId: r.orgId,
            contactId: r.contactId,
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
        <RecipientSteps r={r} onOrgPicked={onOrgPicked} />

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
            {!r.orgId
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
