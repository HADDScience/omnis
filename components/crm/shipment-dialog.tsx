"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Step } from "./step"
import { EntityPicker } from "./entity-picker"
import { ConcField, MlField, concOk, mlOk } from "./gel-fields"
import type { GelTypeView } from "./production-dialog"
import { concText, fmtNum, lotMl, mlText, round3 } from "@/lib/crm-gel"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/base-path"

/** 젤이 아닌 완제품 — 개수로 센다 */
export interface GoodsOption {
  id: string
  code: string
  name: string
  spec: string | null
  kind: string | null
  balance: number
}

export type ShipmentKind = "SALE" | "SAMPLE" | "GIFT"

export interface ShipmentEdit {
  id: string
  code: string
  shippedAt: string
  kind: ShipmentKind
  orgId: string
  productId: string
  concentrationPct: number | null
  /** 젤 출고 ml */
  volumeMl: number | null
  /** 젤이 아닌 출고 개수 */
  quantity: number | null
  note: string | null
  /** 재고에 반영된 출고인가 — 엑셀에서 넘어온 지난 출고는 아니다 */
  ledger: boolean
  /** 샘플요청에서 나온 출고면 그 코드 — 기관 · 제품은 샘플요청에서 고친다 */
  sampleCode: string | null
}

const KINDS: [ShipmentKind, string][] = [["SALE", "판매"], ["SAMPLE", "샘플"], ["GIFT", "증정"]]
const today = () => new Date().toISOString().slice(0, 10)
const shortName = (name: string) => name.replace(/\s*\(.*\)$/, "")

/**
 * 출고 적기 · 고치기 팝업 — 생산 팝업과 같은 순서로 한 단계씩 연다.
 * ① 무엇을 → ② 농도(지금 재고) → ③ 나가는 양(ml · 젤이 아니면 개수) → ④ 거래처 · 날짜 · 유형 · 메모 → ⑤ 확인(재고 차감 미리보기).
 * 재고가 모자라도 막지 않는다 — 실제로 나간 물건을 못 적게 하면 장부 밖에서 처리하게 된다. 대신 빨갛게 알린다.
 * 고치기에서는 다섯 단계가 처음부터 다 열려 있다.
 */
export function ShipmentDialog({
  open,
  onOpenChange,
  gels,
  goods,
  orgs,
  edit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  gels: GelTypeView[]
  goods: GoodsOption[]
  orgs: { id: string; name: string }[]
  edit?: ShipmentEdit | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [productId, setProductId] = useState<string | null>(edit?.productId ?? null)
  const [conc, setConc] = useState(edit?.concentrationPct != null ? String(edit.concentrationPct) : "")
  const [ml, setMl] = useState(edit?.volumeMl != null ? String(edit.volumeMl) : "")
  const [qty, setQty] = useState(edit?.quantity != null ? String(edit.quantity) : "")
  const [orgId, setOrgId] = useState<string | null>(edit?.orgId ?? null)
  const [date, setDate] = useState(edit?.shippedAt ?? today())
  const [kind, setKind] = useState<ShipmentKind>(edit?.kind ?? "SALE")
  const [note, setNote] = useState(edit?.note ?? "")
  const [stepsDone, setStepsDone] = useState(Boolean(edit))

  const locked = Boolean(edit?.sampleCode)
  const gel = gels.find((g) => g.id === productId) ?? null
  const good = goods.find((g) => g.id === productId) ?? null
  const concNum = gel && concOk(conc) ? round3(Number(conc)) : null
  const take = gel ? (mlOk(ml) ? round3(Number(ml)) : 0) : Number.isInteger(Number(qty)) && Number(qty) >= 1 ? Number(qty) : 0
  const hasAmount = take > 0
  const unit = (n: number) => (gel ? mlText(n) : `${fmtNum(n)}개`)

  // 고치기면 이 출고가 이미 뺀 양을 돌려놓고 본다(같은 제품 · 같은 칸일 때만, 재고에 반영된 출고만)
  const own = (() => {
    if (!edit?.ledger || edit.productId !== productId) return 0
    if (gel) return edit.concentrationPct != null && concNum === round3(edit.concentrationPct) ? edit.volumeMl ?? 0 : 0
    return edit.quantity ?? 0
  })()
  const stockBefore = gel ? (concNum != null ? round3(lotMl(gel.lots, concNum) + own) : 0) : good ? good.balance + own : 0
  const stockAfter = round3(stockBefore - take)
  // 미반영 출고를 고치면 재고는 그대로다
  const touchesStock = !edit || edit.ledger
  const short = touchesStock && stockAfter < 0

  const show2 = Boolean(gel)
  const show3 = gel ? concNum != null : Boolean(good)
  const show4 = show3 && hasAmount
  const show5 = show4 && Boolean(orgId) && (stepsDone || date !== "")
  const orgName = orgs.find((o) => o.id === orgId)?.name ?? ""
  const productLine = gel ? `${gel.name} · ${concNum != null ? concText(concNum) : ""}` : good ? `${good.name}${good.spec ? ` ${good.spec}` : ""}` : ""

  function pick(id: string | null) {
    setProductId(id)
    if (id !== productId) {
      // 다른 제품으로 옮기면 그 제품의 칸부터 다시 고른다(개수 · ml 를 섞지 않는다)
      setConc("")
      setMl("")
      setQty("")
    }
  }

  function save() {
    if (!productId || !orgId || !hasAmount || (gel && concNum == null)) return
    startTransition(async () => {
      try {
        const body: Record<string, unknown> = {
          shippedAt: date,
          kind,
          note: note.trim() || null,
          ...(locked ? {} : { orgId, productId }),
          ...(gel ? { concentrationPct: concNum, volumeMl: take } : { quantity: take }),
        }
        if (!edit) Object.assign(body, { orgId, productId, status: "DELIVERED" })
        const res = await fetch(apiUrl(edit ? `/api/crm/shipments/${edit.id}` : "/api/crm/shipments"), {
          method: edit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "출고를 적지 못했습니다")
        toast.success(`${data.code} — ${data.summary}${edit ? " 로 고쳤어요" : " 출고를 적었어요"}`, {
          description: touchesStock ? (edit ? "재고를 다시 계산했습니다" : "재고에서 뺐습니다") : "미반영 출고라 재고는 그대로입니다",
        })
        if (short) toast.warning(`재고가 ${unit(-stockAfter)} 모자랍니다 — 재고가 음수입니다`, { duration: 10_000 })
        onOpenChange(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  const goodsOptions = goods.map((g) => ({
    id: g.id,
    label: g.name,
    hint: [g.spec, `${g.balance}개 남음`].filter(Boolean).join(" · "),
    keywords: `${g.spec ?? ""} ${g.kind ?? ""} ${g.code}`,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-shipment-dialog className="max-h-[88vh] w-[calc(var(--app-vw,100vw)-1.5rem)] max-w-lg gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? `출고 고치기 · ${edit.code}` : "출고 적기"}</DialogTitle>
          <DialogDescription>
            {edit
              ? edit.ledger ? "고치면 재고를 다시 계산합니다." : "엑셀에서 넘어온 「미반영」 출고라 고쳐도 재고는 바뀌지 않습니다."
              : "하나씩 고르면 다음 칸이 나옵니다."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* ① 무엇을 */}
          <Step label="① 무엇을 내보냈나요?" hint={locked ? `샘플요청 ${edit!.sampleCode} 에서 나온 출고 — 제품은 샘플요청에서 고칩니다` : undefined}>
            <div className="grid grid-cols-2 gap-2">
              {gels.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  data-gel-type={g.gelType}
                  disabled={locked && g.id !== productId}
                  onClick={() => pick(g.id)}
                  aria-pressed={productId === g.id}
                  className={cn(
                    "glass flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40",
                    productId === g.id ? "border-primary/40 ring-2 ring-primary/20" : "hover:bg-muted/50"
                  )}
                >
                  <span className="text-[14px] font-semibold">{shortName(g.name)}</span>
                  <span className="text-[11px] text-muted-foreground">{g.name.match(/\((.*)\)/)?.[1] ?? g.code}</span>
                </button>
              ))}
            </div>
            {goods.length > 0 && !(locked && gel) && (
              <div className="mt-2" data-shipment-goods>
                <EntityPicker
                  options={goodsOptions}
                  value={good?.id ?? null}
                  onChange={(id) => pick(id)}
                  placeholder="다른 제품(고정제 등) 찾기"
                  emptyLabel="다른 제품 — 개수로 셉니다"
                />
              </div>
            )}
          </Step>

          {/* ② 농도 — 젤만 */}
          <Step show={show2} autoFocus={!edit} label="② 농도" hint="%">
            {gel && <ConcField gelType={gel.gelType} value={conc} onChange={setConc} lots={gel.lots} id="sh-conc" />}
          </Step>

          {/* ③ 나가는 양 */}
          <Step show={show3} label={gel ? "③ 나가는 양(ml)" : "③ 몇 개"} hint={gel ? "여러 개를 보냈으면 모두 더한 ml" : undefined}>
            {gel ? (
              <MlField value={ml} onChange={setMl} label="나가는 양(ml)" />
            ) : (
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-label="몇 개"
                className="h-9 w-[120px] text-right font-mono"
              />
            )}
          </Step>

          {/* ④ 거래처 · 날짜 · 유형 · 메모 */}
          <Step show={show4} label="④ 거래처 · 출고일 · 메모" hint="메모는 선택">
            <div className="flex flex-col gap-3">
              <div data-shipment-org>
                <EntityPicker
                  options={orgs.map((o) => ({ id: o.id, label: o.name }))}
                  value={orgId}
                  onChange={(id) => !locked && setOrgId(id)}
                  placeholder="기관 이름으로 찾기"
                  emptyLabel={locked ? orgName : "어디로 — 기관을 고르세요"}
                />
                {locked && <p className="mt-1 text-[11px] text-muted-foreground">기관은 샘플요청 {edit!.sampleCode} 에서 고칩니다.</p>}
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="출고 유형">
                {KINDS.map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] transition-colors",
                      kind === k ? "border-primary/30 bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStepsDone(true) }} aria-label="출고일" />
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="송장번호 · 동봉 내용 등" aria-label="메모" />
              </div>
            </div>
          </Step>

          {/* ⑤ 확인 */}
          <Step show={show5} label="⑤ 이대로 적을까요?">
            <div className="rounded-xl border bg-muted/40 p-3 text-[13px]" data-shipment-confirm>
              <dl className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">출고</dt>
                  <dd className="text-right font-medium">{productLine}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">양</dt>
                  <dd className="text-right font-mono">{unit(take)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">거래처</dt>
                  <dd className="text-right">{orgName} · {KINDS.find(([k]) => k === kind)?.[1]} · {date}</dd>
                </div>
                <div className="flex justify-between gap-3 border-t pt-1.5">
                  <dt className="text-muted-foreground">재고{gel && concNum != null ? ` (${concText(concNum)})` : ""}</dt>
                  <dd className="text-right font-mono" data-shipment-stock>
                    {touchesStock ? (
                      <>
                        {unit(stockBefore)} → <b className={cn(short && "text-destructive")}>{unit(stockAfter)}</b>
                      </>
                    ) : (
                      "바뀌지 않음(미반영)"
                    )}
                  </dd>
                </div>
              </dl>
              {short && (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-destructive" data-shipment-short>
                  <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
                  재고가 {unit(round3(-stockAfter))} 모자랍니다. 그래도 적을 수 있고, 재고는 음수가 됩니다.
                </p>
              )}
            </div>
            <Button onClick={save} disabled={pending || !productId || !orgId || !hasAmount || (gel != null && concNum == null) || !date} size="lg" className="mt-3 w-full gap-1.5">
              {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
              {edit ? "고친 대로 저장" : "출고 적기"}
            </Button>
          </Step>
        </div>
      </DialogContent>
    </Dialog>
  )
}
