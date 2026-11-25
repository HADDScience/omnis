"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, ImageAdd02Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Step } from "./step"
import { ConcField, MlField, concOk, mlOk } from "./gel-fields"
import { concText, fmtNum, gelMaterialGrams, lotMl, mlText, round3, type GelLot, type GelType } from "@/lib/crm-gel"
import { cn } from "@/lib/utils"
import { apiUrl } from "@/lib/base-path"

export interface GelTypeView {
  id: string
  code: string
  name: string
  gelType: GelType
  lots: GelLot[]
  /** 이 타입에 이어진 원재료(설정 · 기본 규칙) — 없으면 차감하지 않는다 */
  material: { id: string; name: string; grams: number } | null
}

export interface ProductionEdit {
  id: string
  code: string
  productId: string
  producedAt: string
  concentrationPct: number | null
  totalMl: number
  materialId: string | null
  materialGrams: number
  note: string | null
  photos: { id: string; name: string }[]
}

const today = () => new Date().toISOString().slice(0, 10)

/**
 * 생산 적기 · 고치기 팝업 — 견적 품목 추가처럼 한 단계씩 연다.
 * ① 제품 타입 → ② 농도(지금 재고) → ③ 만든 양(ml) → ④ 생산일 · 메모 · 사진 → ⑤ 확인(원재료 차감 미리보기).
 * 개수는 세지 않는다 — 5ml 3개와 2ml 5개를 만들었으면 25ml 로 적는다(11/25 2차).
 * 고치기에서는 다섯 단계가 처음부터 다 열려 있다(이미 답한 칸이다).
 */
export function ProductionDialog({
  open,
  onOpenChange,
  gels,
  edit,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  gels: GelTypeView[]
  edit?: ProductionEdit | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [productId, setProductId] = useState<string | null>(edit?.productId ?? null)
  const [conc, setConc] = useState(edit?.concentrationPct != null ? String(edit.concentrationPct) : "")
  const [ml, setMl] = useState(edit ? String(edit.totalMl) : "")
  const [date, setDate] = useState(edit?.producedAt ?? today())
  const [note, setNote] = useState(edit?.note ?? "")
  const [photos, setPhotos] = useState<{ id: string; name: string }[]>(edit?.photos ?? [])
  const [uploading, setUploading] = useState(false)
  const [stepsDone, setStepsDone] = useState(Boolean(edit))
  const fileRef = useRef<HTMLInputElement>(null)

  const gel = gels.find((g) => g.id === productId) ?? null
  const concNum = concOk(conc) ? round3(Number(conc)) : null
  const totalMl = mlOk(ml) ? round3(Number(ml)) : 0
  const hasMl = totalMl > 0

  // 고치기면 이 생산이 이미 더한 ml · 뺀 원료를 돌려놓고 본다
  const ownMl = edit && gel && edit.productId === gel.id && edit.concentrationPct != null && concNum === round3(edit.concentrationPct) ? edit.totalMl : 0
  const lotBefore = gel && concNum != null ? round3(lotMl(gel.lots, concNum) - ownMl) : 0
  const material = gel?.material ?? null
  const matBefore = material ? round3(material.grams + (edit && edit.materialId === material.id ? edit.materialGrams : 0)) : 0
  const needGrams = material && concNum != null ? gelMaterialGrams(concNum, totalMl) : 0
  const short = material ? needGrams > matBefore : false

  const show2 = Boolean(gel)
  const show3 = show2 && concNum != null
  const show4 = show3 && hasMl
  const show5 = show4 && (stepsDone || date !== "")

  async function upload(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const f of Array.from(files).slice(0, 10 - photos.length)) {
        const fd = new FormData()
        fd.append("file", f)
        const res = await fetch(apiUrl("/api/files"), { method: "POST", body: fd })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? "사진을 올리지 못했습니다")
        setPhotos((p) => [...p, { id: data.id, name: data.name ?? f.name }])
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "사진을 올리지 못했습니다")
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  function save() {
    if (!gel || concNum == null || !hasMl) return
    startTransition(async () => {
      try {
        const body = {
          producedAt: date,
          productId: gel.id,
          concentrationPct: concNum,
          totalMl,
          note: note.trim() || null,
          photoFileIds: photos.map((p) => p.id),
        }
        const res = await fetch(apiUrl(edit ? `/api/crm/productions/${edit.id}` : "/api/crm/productions"), {
          method: edit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? "생산을 적지 못했습니다")
        toast.success(`${data.code} — ${data.summary}${edit ? " 로 고쳤어요" : " 생산을 적었어요"}`, {
          description: data.materialName ? `${data.materialName} ${data.materialGrams}g 차감` : "원재료는 차감하지 않았습니다",
        })
        for (const w of data.warnings ?? []) toast.warning(w, { duration: 10_000 })
        onOpenChange(false)
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "오류가 발생했습니다")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-production-dialog className="max-h-[88vh] w-[calc(var(--app-vw,100vw)-1.5rem)] max-w-lg gap-4 overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{edit ? `생산 고치기 · ${edit.code}` : "생산 적기"}</DialogTitle>
          <DialogDescription>
            {edit ? "고치면 재고와 원재료 차감을 다시 계산합니다." : "하나씩 고르면 다음 칸이 나옵니다."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* ① 타입 */}
          <Step label="① 무엇을 만들었나요?">
            <div className="grid grid-cols-2 gap-2">
              {gels.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  data-gel-type={g.gelType}
                  onClick={() => setProductId(g.id)}
                  aria-pressed={productId === g.id}
                  className={cn(
                    "glass flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors",
                    productId === g.id ? "border-primary/40 ring-2 ring-primary/20" : "hover:bg-muted/50"
                  )}
                >
                  <span className="text-[14px] font-semibold">{g.name.replace(/\s*\(.*\)$/, "")}</span>
                  <span className="text-[11px] text-muted-foreground">{g.name.match(/\((.*)\)/)?.[1] ?? g.code}</span>
                </button>
              ))}
            </div>
          </Step>

          {/* ② 농도 */}
          <Step show={show2} autoFocus={!edit} label="② 농도" hint="%">
            {gel && <ConcField gelType={gel.gelType} value={conc} onChange={setConc} lots={gel.lots} id="mfg-conc" />}
          </Step>

          {/* ③ 만든 양 */}
          <Step show={show3} label="③ 만든 양(ml)" hint="용량이 섞였으면 모두 더한 ml">
            <MlField value={ml} onChange={setMl} label="만든 양(ml)" />
            {hasMl && (
              <p className="mt-2 text-right text-[12px] text-muted-foreground" data-production-total>
                합계 <b className="font-mono text-foreground">{mlText(totalMl)}</b>
              </p>
            )}
          </Step>

          {/* ④ 날짜 · 메모 · 사진 */}
          <Step show={show4} label="④ 생산일 · 메모 · 사진" hint="메모 · 사진은 선택">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                <Input type="date" value={date} onChange={(e) => { setDate(e.target.value); setStepsDone(true) }} aria-label="생산일" />
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={1} placeholder="로트 · 배치 번호 등" aria-label="메모" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {photos.map((p) => (
                  <div key={p.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={apiUrl(`/api/files/${p.id}/raw`)} alt={p.name} className="h-14 w-14 rounded-lg border object-cover" />
                    <button
                      type="button"
                      aria-label={`${p.name} 빼기`}
                      onClick={() => setPhotos((x) => x.filter((y) => y.id !== p.id))}
                      className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-foreground text-[11px] text-background"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {photos.length < 10 && (
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
                    {uploading ? <Spinner /> : <HugeiconsIcon icon={ImageAdd02Icon} size={14} aria-hidden />}
                    사진
                  </Button>
                )}
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
              </div>
            </div>
          </Step>

          {/* ⑤ 확인 */}
          <Step show={show5} label="⑤ 이대로 적을까요?">
            {gel && concNum != null && (
              <div className="rounded-xl border bg-muted/40 p-3 text-[13px]" data-production-confirm>
                <dl className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">생산</dt>
                    <dd className="text-right font-medium">{gel.name} · {concText(concNum)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">양</dt>
                    <dd className="text-right font-mono">{mlText(totalMl)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">재고 ({concText(concNum)})</dt>
                    <dd className="text-right font-mono">
                      {mlText(lotBefore)} → <b>{mlText(lotBefore + totalMl)}</b>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 border-t pt-1.5">
                    <dt className="text-muted-foreground">원재료 차감</dt>
                    <dd className="text-right font-mono" data-material-grams>
                      {material ? (
                        <>
                          {material.name} −{fmtNum(needGrams)}g
                          <span className="block text-[11px] text-muted-foreground">
                            {fmtNum(matBefore)}g → <span className={cn(short && "font-semibold text-destructive")}>{fmtNum(matBefore - needGrams)}g</span>
                          </span>
                        </>
                      ) : (
                        "없음"
                      )}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  원재료 = {concText(concNum)} × {mlText(totalMl)} (농도는 g/100ml)
                </p>
                {!material && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] text-muted-foreground">
                    <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
                    이 타입에 이어진 원재료가 없어 원재료를 빼지 않습니다.
                  </p>
                )}
                {short && material && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] font-medium text-destructive" data-material-short>
                    <HugeiconsIcon icon={Alert02Icon} size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {material.name} 가 {fmtNum(round3(needGrams - matBefore))}g 모자랍니다. 그래도 적을 수 있고, 원재료 재고는 음수가 됩니다.
                  </p>
                )}
              </div>
            )}
            <Button onClick={save} disabled={pending || uploading || !gel || concNum == null || !hasMl || !date} size="lg" className="mt-3 w-full gap-1.5">
              {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
              {edit ? "고친 대로 저장" : "생산 적기"}
            </Button>
          </Step>
        </div>
      </DialogContent>
    </Dialog>
  )
}
