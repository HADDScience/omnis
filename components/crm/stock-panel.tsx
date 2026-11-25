"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, PlusSignIcon, Tick02Icon, PencilEdit02Icon, Delete02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { EntityPicker, type PickerOption } from "./entity-picker"
import { formatStock } from "@/lib/crm"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/base-path"
import { ProductionDialog, type GelTypeView, type ProductionEdit } from "./production-dialog"
import { ShipmentDialog, type ShipmentEdit } from "./shipment-dialog"
import { ConcField, concOk } from "./gel-fields"
import { concText, lotMl, mlText, round3, variantLabel } from "@/lib/crm-gel"

interface StockView {
  id: string
  code: string
  name: string
  spec: string | null
  kind: string | null
  /** 용량(ml). 없으면 규격 문자열만 있는 품목(세트·동결건조 등) */
  volumeMl: number | null
  unit: "PIECE" | "GRAM" | "ML"
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

interface ProductionView extends ProductionEdit {
  productName: string
  materialName: string | null
}

export interface ShipmentView extends ShipmentEdit {
  orgName: string
  /** 「애드젤 (ADD GEL) · 10%」 · 「고정제 1ml」 */
  productLabel: string
  /** 「5ml」 · 「3개」 */
  amount: string
  kindLabel: string
  statusLabel: string
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * 1개에 드는 원료 그램을 보여줄 때만 반올림한다.
 * 계산에 쓰는 gramsPerUnit 자체는 건드리지 않는다 — 0.0074 × 3 을 미리 자르면
 * 소요량이 틀어진다. 화면에는 2.22e-2 가 "0.022199999999999998g" 로 나오던 것만 막는다.
 */
const perUnitLabel = (g: number) => `${Math.round(g * 10000) / 10000}`

/**
 * 완제품을 제품 → 타입 → 용량 세 단으로 묶는다.
 *
 * 평평한 목록으로 두면 "애드젤"이 시린지 5ml·시린지 2ml·바이알 5ml·세트·동결건조로
 * 다섯 줄에 흩어져, 애드젤이 통틀어 몇 개 남았는지를 사람이 눈으로 더해야 했다.
 * (사용자 지적, 2026-09-09)
 *
 * 타입(kind)이 비어 있는 품목이 있다 — 라이브젤·고정제. 빈 타입에 "기타" 같은
 * 이름을 지어 붙이면 없는 분류를 만드는 셈이라, 소제목 없이 제품 바로 아래에 둔다.
 */
export interface GoodsGroup {
  name: string
  /** 이 제품에 속한 품목 수 */
  count: number
  /** 잔량 합계. 단위가 섞여 있으면 더하지 않는다 */
  total: number | null
  unit: "PIECE" | "GRAM" | "ML"
  kinds: { kind: string; items: StockView[] }[]
}

function groupGoods(goods: StockView[]): GoodsGroup[] {
  const byName = new Map<string, StockView[]>()
  for (const g of goods) {
    const arr = byName.get(g.name)
    if (arr) arr.push(g)
    else byName.set(g.name, [g])
  }

  // 용량 순 — 숫자로 아는 것이 먼저, 모르는 것(세트·동결건조)은 뒤에 이름 순
  const byVolume = (a: StockView, b: StockView) => {
    if (a.volumeMl != null && b.volumeMl != null) return a.volumeMl - b.volumeMl
    if (a.volumeMl != null) return -1
    if (b.volumeMl != null) return 1
    return (a.spec ?? "").localeCompare(b.spec ?? "", "ko")
  }

  return [...byName.entries()].map(([name, items]) => {
    const unit = items[0].unit
    const mixedUnit = items.some((i) => i.unit !== unit)

    const byKind = new Map<string, StockView[]>()
    for (const it of items) {
      const k = it.kind ?? ""
      const arr = byKind.get(k)
      if (arr) arr.push(it)
      else byKind.set(k, [it])
    }

    return {
      name,
      count: items.length,
      total: mixedUnit ? null : items.reduce((sum, i) => sum + i.balance, 0),
      unit,
      kinds: [...byKind.entries()]
        // 타입 없는 묶음이 맨 위 — 제품 바로 아래에 붙어야 읽힌다
        .sort((a, b) => (a[0] === "" ? -1 : b[0] === "" ? 1 : a[0].localeCompare(b[0], "ko")))
        .map(([kind, list]) => ({ kind, items: [...list].sort(byVolume) })),
    }
  })
}

/**
 * 재고 화면.
 *
 * 원료(그램)와 완제품(개)이 생산으로 이어진다. 예전에는 원료 장부만 있고 완제품은
 * 아예 없었다 — 그래서 "DNA 는 있는데 팔 물건이 몇 개 남았나"를 아무도 몰랐다.
 */
export function StockPanel({
  materials,
  goods,
  gels,
  productions,
  shipments = [],
  orgs,
}: {
  materials: StockView[]
  goods: StockView[]
  /** 젤 타입 두 줄 — 재고는 농도별 ml */
  gels: GelTypeView[]
  productions: ProductionView[]
  /** 최근 출고 — 고치기 · 지우기 */
  shipments?: ShipmentView[]
  orgs: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [showIn, setShowIn] = useState(false)
  // 재고 맞추기 — 원료 입고도, 완제품 실사도 여기서 한다
  const [inItemId, setInItemId] = useState<string | null>(materials[0]?.id ?? null)
  const [inQty, setInQty] = useState("")
  const [inDate, setInDate] = useState(today)
  const [inNote, setInNote] = useState("")
  /** 더하기(입고)인지, 센 값으로 맞추기(실사)인지 */
  const [inMode, setInMode] = useState<"add" | "set">("add")

  // 생산 — 팝업(production-dialog)이 단계별로 받는다. 열 때마다 새로 그려 지난 입력이 남지 않게 key 를 바꾼다
  const [mfgOpen, setMfgOpen] = useState(false)
  const [mfgEdit, setMfgEdit] = useState<ProductionEdit | null>(null)
  const [mfgKey, setMfgKey] = useState(0)
  const openMfg = (edit: ProductionEdit | null) => {
    setMfgEdit(edit)
    setMfgKey((k) => k + 1)
    setMfgOpen(true)
  }
  const [deleting, setDeleting] = useState<string | null>(null)

  // 출고 — 생산과 같은 단계별 팝업(shipment-dialog)
  const [shipOpen, setShipOpen] = useState(false)
  const [shipEdit, setShipEdit] = useState<ShipmentEdit | null>(null)
  const [shipKey, setShipKey] = useState(0)
  const openShip = (edit: ShipmentEdit | null) => {
    setShipEdit(edit)
    setShipKey((k) => k + 1)
    setShipOpen(true)
  }

  // 젤 타입 칸(재고 맞추기)
  const [inConc, setInConc] = useState("")

  async function removeShipment(s: ShipmentView) {
    if (deleting !== s.id) {
      setDeleting(s.id)
      toast.info(s.ledger ? `${s.code} 를 지우려면 한 번 더 누르세요 — 재고가 출고 전으로 돌아갑니다` : `${s.code} 를 지우려면 한 번 더 누르세요 — 미반영 출고라 재고는 그대로입니다`)
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(apiUrl(`/api/crm/shipments/${s.id}`), { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "지우지 못했습니다")
        toast.success(`${s.code} 를 지웠어요${s.ledger ? " — 재고를 되돌렸습니다" : ""}`)
        setDeleting(null)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  async function removeProduction(p: ProductionView) {
    if (deleting !== p.id) {
      setDeleting(p.id)
      toast.info(`${p.code} 를 지우려면 한 번 더 누르세요 — 재고와 원재료가 생산 전으로 돌아갑니다`)
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(apiUrl(`/api/crm/productions/${p.id}`), { method: "DELETE" })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "지우지 못했습니다")
        toast.success(`${p.code} 를 지웠어요 — 재고와 원재료를 되돌렸습니다`)
        setDeleting(null)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  async function addStockIn() {
    const v = Number(inQty)
    if (!inItem || !(v > 0 || (inMode === "set" && v === 0))) return
    if (inGel && !concOk(inConc)) return
    // 실사면 센 값과 장부의 차이만큼 적는다. 사람이 뺄셈을 하지 않게. 젤 타입은 고른 농도 칸의 ml 와 비교한다
    const base = inGel ? lotMl(inGel.lots, Number(inConc)) : inItem.balance
    const delta = inMode === "set" ? Math.round((v - base) * 1000) / 1000 : v
    if (delta === 0) {
      toast.info("장부와 같아서 적을 것이 없어요")
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(apiUrl("/api/crm/stock"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            movedAt: inDate,
            productId: inItem.id,
            direction: delta > 0 ? "IN" : "OUT",
            quantity: Math.abs(delta),
            note: inNote || (inMode === "set" ? "실사 보정" : "입고"),
            ...(inGel ? { concentrationPct: Number(inConc) } : {}),
          }),
        })
        if (!res.ok) throw new Error((await res.json()).error ?? "적지 못했습니다")
        toast.success(
          inMode === "set"
            ? `${formatStock(v, inItem.unit)} 로 맞췄어요 (${delta > 0 ? "+" : ""}${delta})`
            : `${formatStock(v, inItem.unit)} 입고를 적었어요`
        )
        setInQty("")
        setInNote("")
        setShowIn(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  // 원료든 완제품이든 다 고를 수 있다. 실사는 완제품에도 필요하다.
  const goodsGroups = groupGoods(goods)
  const gelAsItem = (g: GelTypeView): StockView => {
    const ml = round3(g.lots.reduce((a, l) => a + l.ml, 0))
    return { id: g.id, code: g.code, name: g.name, spec: null, kind: null, volumeMl: null, unit: "ML", inQty: 0, outQty: 0, balance: ml, gramsPerUnit: null, moves: [] }
  }
  const allItems = [...materials, ...gels.map(gelAsItem), ...goods]
  const inItem = allItems.find((x) => x.id === inItemId) ?? null
  const inGel = gels.find((g) => g.id === inItemId) ?? null
  const stockOptions: PickerOption[] = allItems.map((m) => ({
    id: m.id,
    label: m.name,
    hint: [m.spec, m.unit === "ML" ? "농도별 ml" : `${formatStock(m.balance, m.unit)} 남음`].filter(Boolean).join(" · "),
    keywords: `${m.spec ?? ""} ${m.kind ?? ""}`,
  }))

  return (
    <>
      {/* 원료 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-[18px] font-bold tracking-[-0.02em]">원료</h1>
          <Button variant="outline" size="sm" onClick={() => setShowIn((v) => !v)} className="gap-1.5">
            <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
            재고 맞추기
          </Button>
        </div>

        {showIn && (
          <div className="mb-3 rounded-xl border bg-card p-4 animate-in fade-in-0 slide-in-from-top-2 duration-150 motion-reduce:animate-none">
            <div className="mb-3 flex gap-1.5">
              {(["add", "set"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setInMode(m)}
                  aria-pressed={inMode === m}
                  className={cn(
                    "inline-flex h-7 items-center rounded-md border px-2.5 text-[12px] transition-colors",
                    inMode === m
                      ? "border-primary/30 bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {m === "add" ? "들어온 만큼 더하기" : "센 값으로 맞추기"}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_120px_140px]">
              <div>
                <label className="mb-1.5 block text-[12px] text-muted-foreground">품목</label>
                <EntityPicker
                  options={stockOptions}
                  value={inItemId}
                  onChange={setInItemId}
                  placeholder="원료 · 제품 찾기"
                  emptyLabel="품목을 고르세요"
                />
              </div>
              <div>
                <label htmlFor="in-g" className="mb-1.5 block text-[12px] text-muted-foreground">
                  {inMode === "add" ? "들어온 양" : "센 값"}
                  {inItem && ` (${inItem.unit === "GRAM" ? "g" : inItem.unit === "ML" ? "ml" : "개"})`}
                </label>
                <Input
                  id="in-g"
                  type="number"
                  min={0}
                  step={inItem?.unit === "GRAM" ? 0.5 : 1}
                  value={inQty}
                  onChange={(e) => setInQty(e.target.value)}
                  className="text-right"
                  placeholder={inMode === "add" ? "예: 25" : "예: 600"}
                />
              </div>
              <div>
                <label htmlFor="in-d" className="mb-1.5 block text-[12px] text-muted-foreground">
                  {inMode === "add" ? "입고일" : "센 날짜"}
                </label>
                <Input id="in-d" type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} />
              </div>
            </div>
            {inGel && (
              <div className="mt-3">
                <label className="mb-1.5 block text-[12px] text-muted-foreground">농도 — 이 칸의 재고를 맞춥니다</label>
                <ConcField gelType={inGel.gelType} value={inConc} onChange={setInConc} lots={inGel.lots} id="in-conc" />
              </div>
            )}
            {inMode === "set" && inItem && inQty !== "" && (!inGel || concOk(inConc)) && (() => {
              const base = inGel ? lotMl(inGel.lots, Number(inConc)) : inItem.balance
              return (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  장부 <span className="font-mono">{formatStock(base, inItem.unit)}</span> →
                  센 값 <span className="font-mono">{formatStock(Number(inQty), inItem.unit)}</span>
                  {" · "}
                  <b className="font-mono text-foreground">
                    {Number(inQty) - base >= 0 ? "+" : ""}
                    {Math.round((Number(inQty) - base) * 1000) / 1000}
                  </b>{" "}
                  만큼 적습니다
                </p>
              )
            })()}
            <div className="mt-3 flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="in-n" className="mb-1.5 block text-[12px] text-muted-foreground">
                  비고 (선택)
                </label>
                <Input
                  id="in-n"
                  value={inNote}
                  onChange={(e) => setInNote(e.target.value)}
                  placeholder={inMode === "add" ? "구매처 등" : "실사 사유 등"}
                />
              </div>
              <Button
                onClick={addStockIn}
                disabled={pending || !inItem || inQty === "" || (inGel != null && !concOk(inConc))}
                className="gap-1.5"
              >
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
          <Button variant="outline" size="sm" onClick={() => openMfg(null)} className="gap-1.5" disabled={gels.length === 0} data-open-production>
            <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
            생산 적기
          </Button>
        </div>

        <ProductionDialog key={mfgKey} open={mfgOpen} onOpenChange={setMfgOpen} gels={gels} edit={mfgEdit} />

        {productions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
            아직 생산 기록이 없습니다. 적으면 그 농도의 젤 재고가 늘고 원재료가 빠집니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {productions.map((p) => (
              <div
                key={p.id}
                data-production={p.code}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <span className="font-mono text-[11px] text-muted-foreground">{p.code}</span>
                <span className="text-[12px] text-muted-foreground">{p.producedAt}</span>
                <span className="font-medium">{variantLabel(p.productName, p.concentrationPct)}</span>
                <span className="font-mono">{mlText(p.totalMl)}</span>
                {p.photos.length > 0 && <span className="text-[11px] text-muted-foreground">사진 {p.photos.length}</span>}
                <span className="ml-auto font-mono text-[12px] text-muted-foreground">
                  {p.materialName ? `${p.materialName} −${p.materialGrams}g` : "원재료 차감 없음"}
                </span>
                <span className="flex gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`${p.code} 고치기`} onClick={() => openMfg(p)}>
                    <HugeiconsIcon icon={PencilEdit02Icon} size={15} aria-hidden />
                  </Button>
                  <Button
                    variant={deleting === p.id ? "destructive" : "ghost"}
                    size="icon-sm"
                    aria-label={deleting === p.id ? `${p.code} 정말 지우기` : `${p.code} 지우기`}
                    onClick={() => removeProduction(p)}
                    onBlur={() => setDeleting((d) => (d === p.id ? null : d))}
                    disabled={pending}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={15} aria-hidden />
                  </Button>
                </span>
                {p.note && <p className="w-full text-[12px] text-muted-foreground">{p.note}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 젤 — (타입, 농도) 마다 총 ml */}
      {gels.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em]">
            젤 재고 <span className="text-[12px] font-normal text-muted-foreground">농도별 총 ml</span>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {gels.map((g) => {
              const lots = g.lots.filter((l) => l.ml !== 0)
              const total = round3(lots.reduce((a, l) => a + l.ml, 0))
              return (
                <section key={g.id} data-gel-stock={g.gelType} className="glass overflow-hidden rounded-xl border">
                  <header className="flex items-baseline gap-2 border-b px-4 py-2.5">
                    <h3 className="text-[14px] font-semibold">{g.name}</h3>
                    <span className={cn("ml-auto font-mono text-[15px] font-bold", total < 0 && "text-destructive")}>{mlText(total)}</span>
                  </header>
                  {lots.length === 0 ? (
                    <p className="px-4 py-3 text-[12px] text-muted-foreground">재고 없음</p>
                  ) : (
                    <div className="flex flex-col divide-y">
                      {lots.map((l) => (
                        <div key={l.conc} data-gel-lot={`${g.gelType}@${l.conc}`} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2">
                          <span className="text-[13px] font-medium">{l.conc === 0 ? "농도 빈 칸" : concText(l.conc)}</span>
                          <span className={cn("ml-auto font-mono text-[14px] font-semibold", l.ml < 0 && "text-destructive")}>{mlText(l.ml)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">
                    원재료: {g.material ? `${g.material.name} (재고 ${g.material.grams}g)` : "이어진 원재료 없음"}
                  </p>
                </section>
              )
            })}
          </div>
        </section>
      )}

      {/* 완제품 */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[16px] font-bold tracking-[-0.02em]">완제품</h2>
          <Button variant="outline" size="sm" onClick={() => openShip(null)} className="gap-1.5" data-open-shipment>
            <HugeiconsIcon icon={PlusSignIcon} size={14} aria-hidden />
            출고 적기
          </Button>
        </div>

        <ShipmentDialog
          key={shipKey}
          open={shipOpen}
          onOpenChange={setShipOpen}
          gels={gels}
          goods={goods.map((g) => ({ id: g.id, code: g.code, name: g.name, spec: g.spec, kind: g.kind, balance: g.balance }))}
          orgs={orgs}
          edit={shipEdit}
        />

        <div className="flex flex-col gap-3">
          {goodsGroups.map((grp) => (
            <section key={grp.name} className="overflow-hidden rounded-xl border bg-card">
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b bg-muted/40 px-4 py-2.5">
                <h3 className="min-w-0 text-[14px] font-semibold">{grp.name}</h3>
                <span className="shrink-0 text-[11px] text-muted-foreground">{grp.count}종</span>
                {grp.total != null && (
                  <span
                    className={cn(
                      "ml-auto shrink-0 font-mono text-[15px] font-bold",
                      grp.total < 0 && "text-destructive"
                    )}
                  >
                    {formatStock(grp.total, grp.unit)}
                  </span>
                )}
              </header>

              {grp.kinds.map((k) => (
                <div key={k.kind || "_"} className="border-b last:border-b-0">
                  {k.kind && (
                    <div className="px-4 pt-2.5">
                      <Badge variant="outline" className="text-[10.5px]">
                        {k.kind}
                      </Badge>
                    </div>
                  )}
                  <div className="flex flex-col divide-y">
                    {k.items.map((s) => (
                      <StockRow key={s.id} s={s} />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      </section>

      {/* 출고 — 고치기 · 지우기 */}
      <section className="mt-8">
        <h2 className="mb-3 text-[16px] font-bold tracking-[-0.02em]">
          출고 <span className="text-[13px] font-normal text-muted-foreground">최근 {shipments.length}건</span>
        </h2>
        {shipments.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-[13px] text-muted-foreground">
            아직 출고 기록이 없습니다. 적으면 그 칸의 재고가 빠집니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {shipments.map((s) => (
              <div
                key={s.id}
                data-shipment={s.code}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border bg-card px-3 py-2 text-[13px]"
              >
                <span className="font-mono text-[11px] text-muted-foreground">{s.code}</span>
                <span className="text-[12px] text-muted-foreground">{s.shippedAt}</span>
                <Badge variant={s.kind === "SALE" ? "default" : "outline"}>{s.kindLabel}</Badge>
                <Link href={`/crm/orgs/${s.orgId}`} className="min-w-0 truncate hover:underline">{s.orgName}</Link>
                <span className="min-w-0 truncate font-medium">{s.productLabel}</span>
                <span className="font-mono">{s.amount}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {s.statusLabel} · {s.ledger ? "차감됨" : "미반영"}
                </span>
                <span className="flex gap-0.5">
                  <Button variant="ghost" size="icon-sm" aria-label={`${s.code} 고치기`} onClick={() => openShip(s)}>
                    <HugeiconsIcon icon={PencilEdit02Icon} size={15} aria-hidden />
                  </Button>
                  <Button
                    variant={deleting === s.id ? "destructive" : "ghost"}
                    size="icon-sm"
                    aria-label={deleting === s.id ? `${s.code} 정말 지우기` : `${s.code} 지우기`}
                    onClick={() => removeShipment(s)}
                    onBlur={() => setDeleting((d) => (d === s.id ? null : d))}
                    disabled={pending}
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={15} aria-hidden />
                  </Button>
                </span>
                {s.note && <p className="w-full text-[12px] text-muted-foreground">{s.note}</p>}
              </div>
            ))}
          </div>
        )}
        <p className="mt-2.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            「출고 적기」로 적은 건은 재고에서 바로 빠지고, 고치면 다시 계산하고, 지우면 돌아옵니다. 엑셀에서 넘어온 지난
            출고는 「미반영」입니다 — 어떤 생산분에서 나갔는지 기록이 없어 지금 빼면 숫자를 지어내는 셈이라 그대로 뒀습니다.
            실제 양은 「재고 맞추기」의 「센 값으로 맞추기」로 맞출 수 있습니다.
          </span>
        </p>
      </section>
    </>
  )
}

/**
 * 용량 한 줄. 제품명·타입은 위 계층이 이미 말했으므로 되풀이하지 않는다.
 * 이동 내역은 접어 둔다 — 품목마다 6줄씩 펼쳐 두면 그룹이 다시 안 보인다.
 */
function StockRow({ s }: { s: StockView }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium">{s.spec ?? "규격 없음"}</span>
        <span className="font-mono text-[10.5px] text-muted-foreground">{s.code}</span>
        {s.gramsPerUnit != null && (
          <span className="text-[10.5px] text-muted-foreground">1개에 {perUnitLabel(s.gramsPerUnit)}g</span>
        )}
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[14px] font-semibold",
            s.balance < 0 && "text-destructive"
          )}
        >
          {formatStock(s.balance, s.unit)}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[10.5px] text-muted-foreground">
        <span>입고 {formatStock(s.inQty, s.unit)}</span>
        <span>출고 {formatStock(s.outQty, s.unit)}</span>
      </div>

      {s.moves.length > 0 && (
        <details className="mt-1.5">
          <summary className="w-fit cursor-pointer list-none text-[11px] text-muted-foreground underline-offset-2 hover:underline">
            이동 내역 {s.moves.length}건
          </summary>
          <div className="mt-1.5 flex flex-col gap-1 border-t pt-2">
            {s.moves.map((m) => (
              <div key={m.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[12px]">
                <span className="font-mono text-muted-foreground">{m.movedAt}</span>
                <Badge variant={m.direction === "IN" ? "secondary" : "outline"}>
                  {m.direction === "IN" ? "입고" : "출고"}
                </Badge>
                <span className="font-mono">{formatStock(m.quantity, s.unit)}</span>
                {/* 메모는 자르지 않는다 — 320px 에서 141px 이 잘려 나가고 있었다 */}
                {m.note && <span className="min-w-0 text-muted-foreground">{m.note}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
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
          <span className="text-[11px] text-muted-foreground">1개에 {perUnitLabel(s.gramsPerUnit)}g</span>
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
              {m.note && <span className="min-w-0 text-muted-foreground">{m.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
