"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Tick02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { EntityPicker, type PickerOption } from "./entity-picker"
import { Step } from "./step"
import { RecipientSteps } from "./recipient-steps"
import { useRecipient, type OrgLite } from "./use-recipient"

interface ProductLite {
  id: string
  name: string
  spec: string | null
  kind: string | null
}

/**
 * 샘플요청 한 건.
 *
 * 견적과 묻는 순서가 같다 — 기관 → 담당자 → 무엇을 → 마무리. 두 화면이 다르게
 * 동작하면 사람이 두 가지를 외워야 한다.
 *
 * 다른 점은 마지막이다. 견적은 금액을 계산하고, 샘플은 **어디서 왔는지**를 묻는다.
 * 소개경로가 다음 영업의 단서라 엑셀에서도 따로 칸을 뒀다.
 */
export function SampleComposer({
  orgs,
  products,
}: {
  orgs: OrgLite[]
  products: ProductLite[]
}) {
  const router = useRouter()
  const r = useRecipient(orgs)
  const [productId, setProductId] = useState<string | null>(null)
  const [productSkipped, setProductSkipped] = useState(false)
  const [request, setRequest] = useState("")
  const [referral, setReferral] = useState("")
  const [requestedAt, setRequestedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()

  const showProduct = Boolean(r.orgId) && (Boolean(r.contactId) || r.contactSkipped)
  const showFinish = showProduct && (Boolean(productId) || productSkipped)

  const productOptions: PickerOption[] = products.map((p) => ({
    id: p.id,
    label: p.name,
    hint: [p.spec, p.kind].filter(Boolean).join(" · ") || null,
    keywords: `${p.spec ?? ""} ${p.kind ?? ""}`,
  }))

  const canSave = showFinish && !r.busy && !pending

  function save() {
    if (!canSave) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/samples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedAt,
            orgId: r.orgId,
            contactId: r.contactId,
            productId,
            request: request || null,
            referral: referral || null,
            note: note || null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "샘플요청을 저장하지 못했습니다")
        toast.success(`샘플요청 ${data.code} 을 만들었어요`)
        router.push("/crm/samples")
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-[560px] px-6 pb-24 pt-8">
      <h1 className="text-[20px] font-bold tracking-[-0.02em]">새 샘플요청</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        하나씩 채우면 다음 칸이 나옵니다.
      </p>

      <div className="mt-7 flex flex-col gap-5">
        <RecipientSteps r={r} />

        <Step
          show={showProduct}
          autoFocus
          label="어떤 제품인가요?"
          hint={
            !productId && !productSkipped ? (
              <button
                type="button"
                onClick={() => setProductSkipped(true)}
                className="underline underline-offset-2 hover:text-foreground"
              >
                아직 모르면 건너뛰기
              </button>
            ) : null
          }
        >
          <EntityPicker
            options={productOptions}
            value={productId}
            onChange={(id) => {
              setProductId(id)
              if (id) setProductSkipped(false)
            }}
            placeholder="제품 이름 · 규격으로 찾기"
            emptyLabel={productSkipped ? "제품 없이 진행합니다" : "제품을 고르세요"}
          />
        </Step>

        <Step show={showFinish} label="무엇을, 어디서 왔나요?">
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor="s-request" className="mb-1.5 block text-[12px] text-muted-foreground">
                요청사항
              </label>
              <Textarea
                id="s-request"
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                rows={2}
                placeholder="예: 라이브젤 1ml 샘플 및 카다로그 요청"
              />
            </div>
            <div>
              <label htmlFor="s-referral" className="mb-1.5 block text-[12px] text-muted-foreground">
                소개경로
              </label>
              <Input
                id="s-referral"
                value={referral}
                onChange={(e) => setReferral(e.target.value)}
                placeholder="예: 오가노이드 학회 · QR 신청 · ○○ 소개"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                어디서 왔는지가 다음 영업의 단서예요.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="s-date" className="mb-1.5 block text-[12px] text-muted-foreground">
                  요청일자
                </label>
                <Input
                  id="s-date"
                  type="date"
                  value={requestedAt}
                  onChange={(e) => setRequestedAt(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="s-note" className="mb-1.5 block text-[12px] text-muted-foreground">
                  비고 (선택)
                </label>
                <Input
                  id="s-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="발송 일정 등"
                />
              </div>
            </div>
          </div>

          <Button onClick={save} disabled={!canSave} size="lg" className="mt-4 w-full gap-1.5">
            {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
            샘플요청 만들기
          </Button>
        </Step>

        {!showFinish && (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={ArrowRight02Icon} size={13} aria-hidden />
            {!r.orgId
              ? "기관을 고르면 다음 칸이 나옵니다"
              : !showProduct
                ? "담당자를 고르거나 건너뛰면 제품 칸이 나옵니다"
                : "제품을 고르거나 건너뛰면 마지막 칸이 나옵니다"}
          </p>
        )}
      </div>
    </div>
  )
}
