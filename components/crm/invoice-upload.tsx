"use client"

import { useRef, useState } from "react"
import type { DragEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

const MAX_BYTES = 4 * 1024 * 1024
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ko-KR")}원`)

interface Preview {
  invoice: {
    approvalNo: string | null
    direction: "SALE" | "PURCHASE" | null
    kind: string
    originalApprovalNo: string | null
    issuedOn: string | null
    supplierName: string | null
    supplierBizNo: string | null
    buyerName: string | null
    buyerBizNo: string | null
    supplyKrw: number | null
    taxKrw: number | null
    totalKrw: number | null
    readBy: "text" | "vision"
    items: { lineNo: number; name: string; spec: string | null; quantity: number | null; supplyKrw: number; category: string }[]
  }
  plan: {
    counterName: string | null
    counterBizNo: string | null
    org: { id: string; code: string; name: string } | null
    how: string | null
    fillBizNo: boolean
    quote: { id: string; code: string } | null
    elsewhere: { orgName: string; quoteCode: string }[]
    duplicateId: string | null
  }
  blockers: string[]
}

/**
 * 세금계산서 올리기 — 읽은 값을 먼저 보여 주고, 사람이 확인해야 저장한다.
 * 홈택스 PDF 는 글자로 읽고, 이미지 PDF · 사진은 AI 가 읽는다(원본 대조 표시 필요).
 */
export function InvoiceUpload() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<null | "read" | "save">(null)
  const [visionChecked, setVisionChecked] = useState(false)
  const [dragging, setDragging] = useState(false)

  async function post(f: File, fields: Record<string, string>) {
    const fd = new FormData()
    fd.set("file", f)
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    const res = await fetch(apiUrl("/api/crm/invoices"), { method: "POST", body: fd })
    const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null
    if (!res.ok) throw new Error(body?.error ?? "처리하지 못했습니다")
    return body
  }

  async function read(f: File) {
    if (f.size > MAX_BYTES) {
      toast.error("4MB 이하 파일만 올릴 수 있습니다")
      return
    }
    setBusy("read")
    setFile(f)
    setPreview(null)
    setVisionChecked(false)
    try {
      setPreview((await post(f, { mode: "preview" })) as unknown as Preview)
    } catch (err) {
      setFile(null)
      toast.error(err instanceof Error ? err.message : "세금계산서를 읽지 못했습니다")
    } finally {
      setBusy(null)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function save() {
    if (!file || !preview) return
    setBusy("save")
    try {
      const body = (await post(file, {
        mode: "confirm",
        expectApprovalNo: preview.invoice.approvalNo ?? "",
        expectTotal: String(preview.invoice.totalKrw),
        acceptVision: visionChecked ? "1" : "",
      })) as { createdOrg?: { name: string } | null } | null
      toast.success(body?.createdOrg ? `저장했습니다 · 새 기관 「${body.createdOrg.name}」 을 만들었습니다` : "세금계산서를 저장했습니다")
      setPreview(null)
      setFile(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "저장하지 못했습니다")
    } finally {
      setBusy(null)
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && busy === null) void read(f)
  }

  const inv = preview?.invoice
  const plan = preview?.plan
  const vision = inv?.readBy === "vision"
  const canSave = !!preview && preview.blockers.length === 0 && (!vision || visionChecked)

  return (
    <section aria-label="세금계산서 올리기" className="mb-6">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`touch-target flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 transition-colors hover:border-border-strong ${
          dragging ? "border-primary bg-primary/5" : "bg-card"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          className="sr-only"
          disabled={busy !== null}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void read(f)
          }}
        />
        {busy === "read" ? <Spinner /> : null}
        <span className="min-w-0 flex-1 text-[13px]">
          {busy === "read" ? `「${file?.name}」 읽는 중…` : "발행된 세금계산서 PDF 를 끌어다 놓거나 눌러서 고르기"}
        </span>
        <span className="text-[11.5px] text-muted-foreground">PDF · PNG · JPG · 4MB 이하 · 확인 뒤 저장</span>
      </label>

      {inv && plan && (
        <div className="mt-2 rounded-xl border bg-card p-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{inv.direction === "PURCHASE" ? "매입" : "매출"}</Badge>
            {inv.kind === "수정" && <Badge variant="outline">수정 · 당초 {inv.originalApprovalNo ?? "?"}</Badge>}
            {vision ? <Badge variant="destructive">AI 판독</Badge> : <Badge variant="secondary">글자 판독</Badge>}
            <span className="text-[13px] font-semibold tabular-nums">{inv.issuedOn ?? "날짜 없음"}</span>
            <span className="font-mono text-[11.5px] text-muted-foreground">{inv.approvalNo ?? "승인번호 없음"}</span>
            <span className="ml-auto truncate text-[11.5px] text-muted-foreground">{file?.name}</span>
          </div>

          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-[90px_1fr]">
            <dt className="text-muted-foreground">공급자</dt>
            <dd className="break-words">
              {inv.supplierName ?? "—"} <span className="text-muted-foreground">{inv.supplierBizNo}</span>
            </dd>
            <dt className="text-muted-foreground">공급받는자</dt>
            <dd className="break-words">
              {inv.buyerName ?? "—"} <span className="text-muted-foreground">{inv.buyerBizNo}</span>
            </dd>
            <dt className="text-muted-foreground">금액</dt>
            <dd className="tabular-nums">
              공급가액 <b>{fmt(inv.supplyKrw)}</b> · 세액 {fmt(inv.taxKrw)} · 합계 {fmt(inv.totalKrw)}
            </dd>
            <dt className="text-muted-foreground">기관</dt>
            <dd>
              {plan.org ? (
                <>
                  <Link href={`/crm/orgs/${plan.org.id}`} className="hover:underline">
                    {plan.org.name}
                  </Link>{" "}
                  <span className="text-muted-foreground">
                    ({plan.how} 기준{plan.fillBizNo ? " · 사업자번호를 채운다" : ""})
                  </span>
                </>
              ) : (
                <span>새 기관 「{plan.counterName}」 을 만든다</span>
              )}
            </dd>
            {inv.direction !== "PURCHASE" && (
              <>
                <dt className="text-muted-foreground">견적</dt>
                <dd>
                  {plan.quote ? `${plan.quote.code} 에 잇는다 (합계 · 날짜 일치)` : <span className="text-muted-foreground">합계가 맞는 견적 없음</span>}
                  {plan.elsewhere.length > 0 && (
                    <span className="block text-[11.5px] text-amber-700 dark:text-amber-400">
                      합계가 맞는 견적이 다른 기관에 있다: {plan.elsewhere.map((e) => `${e.orgName} ${e.quoteCode}`).join(", ")} — 잇지 않았다
                    </span>
                  )}
                </dd>
              </>
            )}
          </dl>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[420px] text-[12px]">
              <thead className="text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="py-1 text-left font-medium">품목</th>
                  <th scope="col" className="py-1 text-right font-medium">수량</th>
                  <th scope="col" className="py-1 text-right font-medium">공급가액</th>
                  <th scope="col" className="py-1 text-right font-medium">구분</th>
                </tr>
              </thead>
              <tbody>
                {inv.items.map((i) => (
                  <tr key={i.lineNo} className="border-b last:border-b-0">
                    <td className="break-words py-1 pr-2">
                      {i.name}
                      {i.spec ? <span className="text-muted-foreground"> · {i.spec}</span> : null}
                    </td>
                    <td className="py-1 text-right tabular-nums">{i.quantity ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">{fmt(i.supplyKrw)}</td>
                    <td className="py-1 text-right">{i.category}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.blockers.length > 0 && (
            <ul className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {preview.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}

          {vision && preview.blockers.length === 0 && (
            <label className="touch-target mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[12.5px]">
              <input type="checkbox" className="mt-0.5" checked={visionChecked} onChange={(e) => setVisionChecked(e.target.checked)} />
              <span>AI 가 이미지에서 읽은 값입니다. 원본과 승인번호 · 금액 · 품목을 대조했습니다.</span>
            </label>
          )}

          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="touch-target"
              disabled={busy !== null}
              onClick={() => {
                setPreview(null)
                setFile(null)
              }}
            >
              취소
            </Button>
            <Button size="sm" className="touch-target gap-1.5" disabled={!canSave || busy !== null} onClick={save}>
              {busy === "save" && <Spinner />}
              저장
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
