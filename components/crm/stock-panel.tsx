"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { PlusSignIcon, Alert02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { EntityPicker, type PickerOption } from "./entity-picker"
import { formatStock } from "@/lib/crm"
import { cn } from "@/lib/utils"

interface StockView {
  id: string
  code: string
  name: string
  spec: string | null
  kind: string | null
  unit: "PIECE" | "GRAM"
  inQty: number
  outQty: number
  balance: number
  /** 완제품 한 개에 드는 원료(g). 용량·농도가 비면 null */
  gramsPerUnit: number | null
  moves: {
    id: string
    movedAt: string
    direction: "IN" | "OUT"
    quantity: number
    note: string | null
    fromRecord: boolean
  }[]
}

interface ProductionView {
  id: string
  code: string
  producedAt: string
  productName: string
  productSpec: string | null
  quantity: number
  materialName: string
  materialGrams: number
  note: string | null
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * 재고 화면.
 *
 * 원료(그램)와 완제품(개)이 생산으로 이어진다. 예전에는 원료 장부만 있고 완제품은
 * 아예 없었다 — 그래서 "DNA 는 있는데 팔 물건이 몇 개 남았나"를 아무도 몰랐다.
 */
export function StockPanel({
  materials,
  goods,
  productions,
}: {
  materials: StockView[]
  goods: StockView[]
  productions: ProductionView[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [showIn, setShowIn] = useState(false)
  const [showMfg, setShowMfg] = useState(false)

  // 원료 입고
  const [inMaterialId, setInMaterialId] = useState<string | null>(materials[0]?.id ?? null)
  const [inGrams, setInGrams] = useState("")
  const [inDate, setInDate] = useState(today)
  const [inNote, setInNote] = useState("")

  // 생산
  const [mfgProductId, setMfgProductId] = useState<string | null>(null)
  // 원료는 지금 DNA 하나뿐이라 고르게 하지 않는다. 늘어나면 선택기를 붙인다.
  const [mfgMaterialId] = useState<string | null>(materials[0]?.id ?? null)
  const [mfgQty, setMfgQty] = useState("")
  const [mfgDate, setMfgDate] = useState(today)
  const [mfgNote, setMfgNote] = useState("")

  const mfgProduct = goods.find((g) => g.id === mfgProductId) ?? null
  const mfgMaterial = materials.find((m) => m.id === mfgMaterialId) ?? null
  const qtyNum = Number(mfgQty) || 0
  const needGrams =
    mfgProduct?.gramsPerUnit != null && qtyNum > 0
      ? Math.round(qtyNum * mfgProduct.gramsPerUnit * 1000) / 1000
      : null
  // 남은 원료로 몇 개까지 만들 수 있나
  const canMake =
    mfgProduct?.gramsPerUnit != null && mfgProduct.gramsPerUnit > 0 && mfgMaterial
      ? Math.floor(mfgMaterial.balance / mfgProduct.gramsPerUnit)
      : null
  const short = needGrams != null && mfgMaterial ? needGrams > mfgMaterial.balance : false

  async function addStockIn() {
    const g = Number(inGrams)
    if (!inMaterialId || !(g > 0)) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/stock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            movedAt: inDate,
            productId: inMaterialId,
            direction: "IN",
            quantity: g,
            note: inNote || "입고",
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? "입고를 적지 못했습니다")
        toast.success(`${g}g 입고를 적었어요`)
        setInGrams("")
        setInNote("")
        setShowIn(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  async function addProduction() {
    if (!mfgProductId || !mfgMaterialId || qtyNum < 1) return
    startTransition(async () => {
      try {
        const res = await fetch("/api/crm/productions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            producedAt: mfgDate,
            productId: mfgProductId,
            materialId: mfgMaterialId,
            quantity: qtyNum,
            note: mfgNote || null,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "생산을 적지 못했습니다")
        toast.success(`${data.code} — ${qtyNum}개 생산, DNA ${data.materialGrams}g 차감`)
        setMfgQty("")
        setMfgNote("")
        setShowMfg(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  const materialOptions: PickerOption[] = materials.map((m) => ({
    id: m.id,
    label: m.name,
    hint: `${formatStock(m.balance, m.unit)} 남음`,
  }))
  const goodsOptions: PickerOption[] = goods.map((g) => ({
    id: g.id,
    label: g.name,
    hint: [g.spec, g.kind].filter(Boolean).join(" · ") || null,
    keywords: `${g.spec ?? ""} ${g.kind ?? ""}`,
  }))

  return (
    <>
      {/* 원료 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">원료</h1>
          <Button variant="outline" size="sm" onClick={() => setShowIn((v) => !v)} className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
            입고 적기
          </Button>
        </div>

        {showIn && (
          <div className="mb-3 rounded-xl border bg-card p-4 animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
            <div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
              <div>
                <label className="mb-1.5 block text-[12px] text-muted-foreground">원료</label>
                <EntityPicker
                  options={materialOptions}
                  value={inMaterialId}
                  onChange={setInMaterialId}
                  placeholder="원료 고르기"
                  emptyLabel="원료를 고르세요"
                />
              </div>
              <div>
                <label htmlFor="in-g" className="mb-1.5 block text-[12px] text-muted-foreground">
                  입고량 (g)
                </label>
                <Input
                  id="in-g"
                  type="number"
                  min={0}
                  step={0.5}
                  value={inGrams}
                  onChange={(e) => setInGrams(e.target.value)}
                  className="text-right"
                  placeholder="예: 25"
                />
              </div>
              <div>
                <label htmlFor="in-d" className="mb-1.5 block text-[12px] text-muted-foreground">
                  입고일
                </label>
                <Input id="in-d" type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="in-n" className="mb-1.5 block text-[12px] text-muted-foreground">
                  비고 (선택)
                </label>
                <Input id="in-n" value={inNote} onChange={(e) => setInNote(e.target.value)} placeholder="구매처 등" />
              </div>
              <Button onClick={addStockIn} disabled={pending || !(Number(inGrams) > 0)} className="gap-1.5">
                {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={15} aria-hidden />}
                적기
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {materials.map((m) => (
            <StockCard key={m.id} s={m} />
          ))}
        </div>
      </section>

      {/* 생산 */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-bold tracking-[-0.02em]">생산</h2>
          <Button variant="outline" size="sm" onClick={() => setShowMfg((v) => !v)} className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
            생산 적기
          </Button>
        </div>

        {showMfg && (
          <div className="mb-3 rounded-xl border bg-card p-4 animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
            <div className="grid gap-3 sm:grid-cols-[1fr_100px_140px]">
              <div>
                <label className="mb-1.5 block text-[12px] text-muted-foreground">무엇을 만들었나</label>
                <EntityPicker
                  options={goodsOptions}
                  value={mfgProductId}
                  onChange={setMfgProductId}
                  placeholder="제품 고르기"
                  emptyLabel="제품을 고르세요"
                />
              </div>
              <div>
                <label htmlFor="m-q" className="mb-1.5 block text-[12px] text-muted-foreground">
                  개수
                </label>
                <Input
                  id="m-q"
                  type="number"
                  min={1}
                  value={mfgQty}
                  onChange={(e) => setMfgQty(e.target.value)}
                  className="text-right"
                />
              </div>
              <div>
                <label htmlFor="m-d" className="mb-1.5 block text-[12px] text-muted-foreground">
                  생산일
                </label>
                <Input id="m-d" type="date" value={mfgDate} onChange={(e) => setMfgDate(e.target.value)} />
              </div>
            </div>

            {/* 소요량은 사람이 계산하지 않는다 */}
            {mfgProduct && (
              <div className="mt-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-[12px]">
                {mfgProduct.gramsPerUnit == null ? (
                  <span className="flex items-start gap-1.5 text-muted-foreground">
                    <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
                    <span>
                      {mfgProduct.name} 은 용량(ml)이나 농도(wt%)가 비어 있어 소요량을 계산할 수 없어요.
                      제품 정보를 채워야 합니다.
                    </span>
                  </span>
                ) : (
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-muted-foreground">
                      1개에 DNA <b className="font-mono text-foreground">{mfgProduct.gramsPerUnit}g</b>
                    </span>
                    {needGrams != null && (
                      <span className="text-muted-foreground">
                        {qtyNum}개 →{" "}
                        <b className={cn("font-mono", short ? "text-destructive" : "text-foreground")}>
                          {needGrams}g
                        </b>{" "}
                        필요
                      </span>
                    )}
                    {mfgMaterial && (
                      <span className="text-muted-foreground">
                        재고 <span className="font-mono">{mfgMaterial.balance}g</span>
                        {canMake != null && ` · 최대 ${canMake}개`}
                      </span>
                    )}
                    {short && <span className="font-medium text-destructive">원료가 모자랍니다</span>}
                  </div>
                )}
              </div>
            )}

            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="m-n" className="mb-1.5 block text-[12px] text-muted-foreground">
                  비고 (선택)
                </label>
                <Input id="m-n" value={mfgNote} onChange={(e) => setMfgNote(e.target.value)} placeholder="배치 번호 등" />
              </div>
              <Button
                onClick={addProduction}
                disabled={pending || !mfgProductId || qtyNum < 1 || mfgProduct?.gramsPerUnit == null}
                className="gap-1.5"
              >
                {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={15} aria-hidden />}
                적기
              </Button>
            </div>
          </div>
        )}

        {productions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
            아직 생산 기록이 없습니다. 적으면 원료가 빠지고 완제품 재고가 늘어납니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {productions.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                <span className="text-[12px] text-muted-foreground">{p.producedAt}</span>
                <span className="font-medium">{p.productName}</span>
                {p.productSpec && <span className="text-[11px] text-muted-foreground">{p.productSpec}</span>}
                <span className="font-mono">{p.quantity}개</span>
                <span className="ml-auto font-mono text-[12px] text-muted-foreground">
                  {p.materialName} −{p.materialGrams}g
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 완제품 */}
      <section className="mt-8">
        <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em]">완제품</h2>
        <div className="flex flex-col gap-2">
          {goods.map((g) => (
            <StockCard key={g.id} s={g} />
          ))}
        </div>
      </section>
    </>
  )
}

function StockCard({ s }: { s: StockView }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[14px] font-semibold">{s.name}</span>
        {s.spec && <span className="text-[12px] text-muted-foreground">{s.spec}</span>}
        {s.kind && <Badge variant="outline">{s.kind}</Badge>}
        {s.gramsPerUnit != null && (
          <span className="text-[11px] text-muted-foreground">1개에 {s.gramsPerUnit}g</span>
        )}
        <span
          className={cn(
            "ml-auto font-mono text-[15px] font-bold",
            s.balance < 0 && "text-destructive"
          )}
        >
          {formatStock(s.balance, s.unit)}
        </span>
      </div>
      <div className="mt-1 flex gap-3 font-mono text-[11px] text-muted-foreground">
        <span>입고 {formatStock(s.inQty, s.unit)}</span>
        <span>출고 {formatStock(s.outQty, s.unit)}</span>
      </div>

      {s.moves.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 border-t pt-2.5">
          {s.moves.map((m) => (
            <div key={m.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="font-mono text-muted-foreground">{m.movedAt}</span>
              <Badge variant={m.direction === "IN" ? "secondary" : "outline"}>
                {m.direction === "IN" ? "입고" : "출고"}
              </Badge>
              <span className="font-mono">{formatStock(m.quantity, s.unit)}</span>
              {m.note && <span className="truncate text-muted-foreground">{m.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
