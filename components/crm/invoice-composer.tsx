"use client"

import { useMemo, useRef, useState, useTransition, type DragEvent } from "react"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight02Icon, CloudUploadIcon, Tick02Icon } from "@hugeicons/core-free-icons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Step } from "./step"
import { apiUrl } from "@/lib/base-path"
import { cn } from "@/lib/utils"
import { DEMO_STORAGE_MESSAGE, IS_DEMO } from "@/lib/demo"

/**
 * 세금계산서 등록 — 새로 만들기의 한 갈래 (2026-09-17).
 *
 * 견적 · 샘플과 같은 방식이다: 한 번에 하나씩 묻고, 앞의 답이 정해져야 다음이 나온다.
 *   1. 무엇을 올리나요?  — 엑셀이든 PDF 든 한 칸에. 파일 종류를 사람에게 고르게 하지 않는다
 *   2. 이렇게 읽었어요  — **사람이 답해야 하는 것만 위로** 모은다. 나머지는 이미 끝난 것으로 접어 둔다
 *   3. 저장할까요?      — 답이 다 모이면 나온다
 *
 * 견적에서 열었으면(?quote=) 그 견적이 위에 잡혀 있고, 맞는 세금계산서에는 미리 이어 둔다.
 */

type Direction = "SALE" | "PURCHASE" | null

interface Invoice {
  approvalNo: string | null
  direction: Direction
  kind: "일반" | "수정"
  originalApprovalNo: string | null
  issuedOn: string | null
  supplierName: string | null
  buyerName: string | null
  supplyKrw: number | null
  totalKrw: number | null
  readBy: "text" | "vision" | "excel"
  items: { name: string; category: "제품" | "용역" }[]
}

interface Plan {
  counterName: string | null
  org: { id: string; code: string; name: string } | null
  quote: { id: string; code: string } | null
  duplicateId: string | null
  attachToId: string | null
  twin: { id: string; approvalNo: string } | null
  supersededBy: { approvalNo: string } | null
}

interface Candidate {
  id: string
  code: string
  orgName: string
  sameOrg: boolean
  quotedAt: string
  total: number
  invoiced: boolean
  sameTotal: boolean
}

interface Row {
  key: string
  file: File
  invoice: Invoice
  plan: Plan
  blockers: string[]
  candidates: Candidate[]
}

interface Decision {
  quoteId?: string | null
  twinIsDifferent?: boolean
  keepOriginal?: boolean
  acceptVision?: boolean
  skip?: boolean
}

export interface QuoteContext {
  id: string
  code: string
  orgName: string
  total: number
}

const won = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ko-KR")}원`)
const MAX_BYTES = 4 * 1024 * 1024
const ACCEPT = ".xls,.xlsx,application/pdf,image/png,image/jpeg"

/** 이 줄에 사람이 답해야 하는 질문 — 없으면 null */
function questionOf(row: Row): "readFail" | "superseded" | "twin" | "vision" | "quote" | null {
  if (row.plan.duplicateId) return null
  const others = row.blockers.filter((b) => !b.startsWith("같은 날") && !b.startsWith("이미 올린") && !b.startsWith("이미 수정 발행"))
  if (others.length) return "readFail"
  if (row.plan.supersededBy) return "superseded"
  if (row.plan.twin) return "twin"
  if (row.invoice.readBy === "vision") return "vision"
  // 수정세금계산서는 견적을 따로 묻지 않는다 — 당초 장의 답을 따른다(울산대: 당초 · 취소 · 재발행에 같은 질문 세 번)
  if (row.invoice.kind === "수정") return null
  if (row.invoice.direction === "SALE" && !row.plan.quote && row.candidates.length > 0) return "quote"
  return null
}

function answered(row: Row, d: Decision | undefined): boolean {
  const q = questionOf(row)
  if (!q) return true
  if (d?.skip) return true
  if (q === "readFail") return true // 저장할 수 없는 줄 — 건너뛰는 것 말고는 할 일이 없다
  if (q === "superseded") return d?.keepOriginal === true
  if (q === "twin") return d?.twinIsDifferent === true
  if (q === "vision") return d?.acceptVision === true
  if (q === "quote") return d?.quoteId !== undefined
  return true
}

export function InvoiceComposer({ quote }: { quote: QuoteContext | null }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [failedFiles, setFailedFiles] = useState<{ name: string; error: string }[]>([])
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [pending, startTransition] = useTransition()

  const decide = (key: string, patch: Decision) => setDecisions((p) => ({ ...p, [key]: { ...p[key], ...patch } }))

  async function readFiles(list: FileList | File[]) {
    const files = [...list]
    if (!files.length) return
    setRows([])
    setDecisions({})
    setFailedFiles([])
    setReading({ done: 0, total: files.length })
    const collected: Row[] = []
    const failed: { name: string; error: string }[] = []
    const preset: Record<string, Decision> = {}
    // 한 장씩 보낸다 — 요청 본문 한도(4.5MB) 안에서 여러 장을 올리려면 나눠야 한다
    for (const [i, f] of files.entries()) {
      if (f.size > MAX_BYTES) {
        failed.push({ name: f.name, error: "4MB 를 넘습니다" })
      } else {
        const form = new FormData()
        form.append("file", f)
        form.append("mode", "preview")
        const res = await fetch(apiUrl("/api/crm/invoices/import"), { method: "POST", body: form }).catch(() => null)
        const data = res ? await res.json().catch(() => null) : null
        if (!res?.ok || !data?.rows) {
          failed.push({ name: f.name, error: data?.error ?? "읽지 못했습니다" })
        } else {
          for (const [j, r] of (data.rows as Omit<Row, "key" | "file">[]).entries()) {
            const key = r.invoice.approvalNo ?? `${f.name}#${j}`
            // 견적에서 열었으면 그 견적이 후보에 있는 세금계산서에 미리 잇는다
            if (quote && r.candidates.some((c) => c.id === quote.id)) preset[key] = { quoteId: quote.id }
            collected.push({ ...r, key, file: f })
          }
        }
      }
      setReading({ done: i + 1, total: files.length })
    }
    setRows(collected)
    setDecisions(preset)
    setFailedFiles(failed)
    setReading(null)
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    setDragging(false)
    void readFiles(e.dataTransfer.files)
  }

  const groups = useMemo(() => {
    const exists = rows.filter((r) => r.plan.duplicateId)
    const ask = rows.filter((r) => !r.plan.duplicateId && questionOf(r))
    const ready = rows.filter((r) => !r.plan.duplicateId && !questionOf(r))
    return { exists, ask, ready }
  }, [rows])

  const toSave = rows.filter((r) => {
    const q = questionOf(r)
    const d = decisions[r.key]
    return !r.plan.duplicateId && q !== "readFail" && !d?.skip && answered(r, d)
  })
  const unanswered = groups.ask.filter((r) => !answered(r, decisions[r.key]))
  const showRead = rows.length > 0 || failedFiles.length > 0
  const showSave = showRead && unanswered.length === 0 && toSave.length > 0

  function save() {
    startTransition(async () => {
      // 파일마다 한 번 — 서버가 파일을 다시 읽고 답만 받아 저장한다
      const byFile = new Map<File, Row[]>()
      for (const r of toSave) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r])
      let saved = 0
      let attached = 0
      const problems: string[] = []
      for (const [file, list] of byFile) {
        const form = new FormData()
        form.append("file", file)
        form.append("mode", "confirm")
        const ds: Record<string, Decision> = {}
        for (const r of rows.filter((x) => x.file === file)) {
          if (!r.invoice.approvalNo) continue
          if (!list.includes(r)) {
            ds[r.invoice.approvalNo] = { skip: true }
            continue
          }
          // 수정 장은 당초 장이 고른 견적을 그대로 잇는다
          const root = r.invoice.kind === "수정" && r.invoice.originalApprovalNo ? rows.find((x) => x.invoice.approvalNo === r.invoice.originalApprovalNo) : null
          ds[r.invoice.approvalNo] = root ? { ...decisions[r.key], quoteId: decisions[root.key]?.quoteId } : (decisions[r.key] ?? {})
        }
        form.append("decisions", JSON.stringify(ds))
        const res = await fetch(apiUrl("/api/crm/invoices/import"), { method: "POST", body: form }).catch(() => null)
        const data = res ? await res.json().catch(() => null) : null
        if (!res?.ok) {
          problems.push(`${file.name}: ${data?.error ?? "저장 실패"}`)
          continue
        }
        for (const x of data.results as { status: string; message?: string; approvalNo: string | null }[]) {
          if (x.status === "saved") saved++
          if (x.status === "attached") attached++
          if (x.status === "failed") problems.push(`${x.approvalNo ?? file.name}: ${x.message}`)
        }
      }
      if (problems.length) toast.error(`${problems.length}장은 저장하지 못했어요 — ${problems[0]}`)
      if (saved || attached) {
        toast.success(`${saved ? `${saved}장 저장` : ""}${saved && attached ? " · " : ""}${attached ? `PDF ${attached}장 붙임` : ""}`)
        router.push(quote ? `/crm/quotes/${quote.id}` : "/crm/invoices")
        router.refresh()
      }
    })
  }

  return (
    <div className="mx-auto w-full max-w-[640px] px-6 pb-24 pt-8">
      <h1 className="text-[20px] font-bold tracking-[-0.02em]">세금계산서 등록</h1>
      <p className="mt-1 text-[13px] text-muted-foreground">하나씩 채우면 다음 칸이 나옵니다.</p>

      {quote && (
        <div className="mt-5 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-[13px]">
          <span className="font-medium">{quote.orgName}</span> · 견적 {quote.code} · 합계 {won(quote.total)}
          <p className="mt-0.5 text-[12px] text-muted-foreground">이 견적의 세금계산서를 올리면 자동으로 이어집니다.</p>
        </div>
      )}

      <div className="mt-7 flex flex-col gap-6">
        {/* 1 — 무엇을 */}
        <Step label="무엇을 올리나요?" hint="홈택스 목록조회 엑셀 한 장이면 한 달치가 한 번에 들어갑니다">
          {IS_DEMO ? (
            <p className="rounded-xl border border-dashed p-5 text-[13px] text-muted-foreground">{DEMO_STORAGE_MESSAGE}</p>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-5 py-8 text-center transition-colors",
                dragging ? "border-primary bg-primary/5" : "hover:border-border-strong hover:bg-muted/40"
              )}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => e.target.files && void readFiles(e.target.files)}
              />
              {reading ? (
                <>
                  <Spinner />
                  <span className="text-[13px]">읽는 중 {reading.done} / {reading.total}</span>
                </>
              ) : (
                <>
                  <HugeiconsIcon icon={CloudUploadIcon} size={26} className="text-muted-foreground" aria-hidden />
                  <span className="text-[14px] font-medium">파일을 끌어다 놓거나 눌러서 고르세요</span>
                  <span className="text-[12px] text-muted-foreground">홈택스 목록 엑셀 · 세금계산서 PDF 여러 장 · 사진</span>
                </>
              )}
            </label>
          )}
        </Step>

        {/* 2 — 읽은 결과. 물어야 할 것만 위로 */}
        <Step show={showRead && !reading} label={groups.ask.length ? "이것만 확인해 주세요" : "이렇게 읽었어요"} hint={summaryText(rows)}>
          <div className="flex flex-col gap-3">
            {groups.ask.map((r) => (
              <QuestionCard key={r.key} row={r} decision={decisions[r.key]} onDecide={(p) => decide(r.key, p)} contextQuoteId={quote?.id ?? null} />
            ))}

            {groups.ready.length > 0 && (
              <details className="rounded-xl border bg-card px-4 py-3" open={groups.ask.length === 0}>
                <summary className="cursor-pointer text-[13px] font-medium">
                  바로 저장할 수 있는 {groups.ready.length}장
                </summary>
                <ul className="mt-2 flex flex-col divide-y text-[12.5px]">
                  {groups.ready.map((r) => (
                    <InvoiceLine key={r.key} row={r} />
                  ))}
                </ul>
              </details>
            )}

            {groups.exists.length > 0 && (
              <p className="text-[12px] text-muted-foreground">이미 들어와 있는 {groups.exists.length}장은 건너뜁니다.</p>
            )}
            {failedFiles.map((f) => (
              <p key={f.name} className="text-[12px] text-destructive">
                {f.name} — {f.error}
              </p>
            ))}
          </div>
        </Step>

        {/* 3 — 저장 */}
        <Step show={showSave} label="저장할까요?">
          <Button onClick={save} disabled={pending} size="lg" className="w-full gap-1.5">
            {pending ? <Spinner /> : <HugeiconsIcon icon={Tick02Icon} size={16} aria-hidden />}
            {toSave.length}장 저장
          </Button>
        </Step>

        {showRead && !reading && !showSave && (
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <HugeiconsIcon icon={ArrowRight02Icon} size={13} aria-hidden />
            {unanswered.length
              ? `위 ${unanswered.length}장에 답하면 저장 버튼이 나옵니다`
              : "저장할 새 세금계산서가 없습니다"}
          </p>
        )}
      </div>
    </div>
  )
}

function summaryText(rows: Row[]) {
  const sale = rows.filter((r) => r.invoice.direction === "SALE" && !r.plan.duplicateId).length
  const purchase = rows.filter((r) => r.invoice.direction === "PURCHASE" && !r.plan.duplicateId).length
  const parts = [sale && `매출 ${sale}장`, purchase && `매입 ${purchase}장`].filter(Boolean)
  return parts.join(" · ")
}

function counterOf(inv: Invoice) {
  return (inv.direction === "PURCHASE" ? inv.supplierName : inv.buyerName) ?? "—"
}

function InvoiceLine({ row }: { row: Row }) {
  const inv = row.invoice
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5">
      <Badge variant={inv.direction === "PURCHASE" ? "secondary" : "default"}>{inv.direction === "PURCHASE" ? "매입" : "매출"}</Badge>
      {inv.kind === "수정" && <Badge variant="outline">수정</Badge>}
      <span className="tabular-nums text-muted-foreground">{inv.issuedOn}</span>
      <span className="min-w-0 truncate font-medium">{counterOf(inv)}</span>
      <span className="ml-auto tabular-nums">{won(inv.totalKrw)}</span>
      {row.plan.quote && <span className="w-full text-[11px] text-muted-foreground">견적 {row.plan.quote.code} 에 이어짐</span>}
      {row.plan.attachToId && <span className="w-full text-[11px] text-muted-foreground">이미 있는 기록에 PDF 를 붙입니다</span>}
      {!row.plan.org && row.plan.counterName && (
        <span className="w-full text-[11px] text-muted-foreground">
          {inv.direction === "PURCHASE" ? "매입처" : "기관"} 「{row.plan.counterName}」 이 새로 생깁니다
        </span>
      )}
    </li>
  )
}

/** 한 장에 하나의 질문. 답하면 카드가 접힌 모양으로 바뀌어 끝났다는 게 보인다 */
function QuestionCard({
  row,
  decision,
  onDecide,
  contextQuoteId,
}: {
  row: Row
  decision: Decision | undefined
  onDecide: (p: Decision) => void
  contextQuoteId: string | null
}) {
  const q = questionOf(row)
  const done = answered(row, decision) && q !== "readFail"
  const inv = row.invoice

  return (
    <div className={cn("rounded-xl border p-4 transition-colors", done ? "bg-muted/30" : "border-primary/40 bg-card")}>
      <ul>
        <InvoiceLine row={row} />
      </ul>

      {q === "readFail" && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          이 파일은 칸을 다 읽지 못했어요({row.blockers[0]}). 홈택스 목록조회 엑셀로 올리면 양식과 상관없이 들어갑니다.
        </p>
      )}

      {q === "superseded" && (
        <div className="mt-2">
          <p className="text-[13px]">
            이 세금계산서는 이미 수정 발행됐어요 <span className="text-muted-foreground">(수정 승인번호 {row.plan.supersededBy!.approvalNo})</span>.
            당초 장을 넣으면 매출이 두 번 잡힙니다.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Choice active={decision?.skip === true} onClick={() => onDecide({ skip: true, keepOriginal: false })}>
              건너뛰기 (권장)
            </Choice>
            <Choice active={decision?.keepOriginal === true} onClick={() => onDecide({ keepOriginal: true, skip: false })}>
              취소 장도 함께 넣어요 — 저장
            </Choice>
          </div>
        </div>
      )}

      {q === "twin" && (
        <div className="mt-2">
          <p className="text-[13px]">
            같은 날 · 같은 거래처 · 같은 금액이 이미 있어요 <span className="text-muted-foreground">(승인번호 {row.plan.twin!.approvalNo})</span>. 다른 건인가요?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Choice active={decision?.twinIsDifferent === true} onClick={() => onDecide({ twinIsDifferent: true, skip: false })}>
              다른 건이에요 — 저장
            </Choice>
            <Choice active={decision?.skip === true} onClick={() => onDecide({ skip: true, twinIsDifferent: false })}>
              같은 건이에요 — 건너뛰기
            </Choice>
          </div>
        </div>
      )}

      {q === "vision" && (
        <div className="mt-2">
          <p className="text-[13px]">AI 가 읽었어요. 원본과 날짜 · 금액이 맞나요?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Choice active={decision?.acceptVision === true} onClick={() => onDecide({ acceptVision: true, skip: false })}>
              맞아요
            </Choice>
            <Choice active={decision?.skip === true} onClick={() => onDecide({ skip: true, acceptVision: false })}>
              아니에요 — 건너뛰기
            </Choice>
          </div>
        </div>
      )}

      {q === "quote" && (
        <div className="mt-2">
          <p className="text-[13px]">어느 견적의 세금계산서인가요?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {row.candidates.map((c) => (
              <Choice key={c.id} active={decision?.quoteId === c.id} onClick={() => onDecide({ quoteId: c.id, skip: false })}>
                {c.code} · {won(c.total)}
                {!c.sameOrg && <span className="ml-1 text-muted-foreground">{c.orgName}</span>}
                {c.invoiced && <span className="ml-1 text-muted-foreground">이미 발행</span>}
                {c.id === contextQuoteId && <span className="ml-1 text-primary">지금 견적</span>}
              </Choice>
            ))}
            <Choice active={decision?.quoteId === null} onClick={() => onDecide({ quoteId: null, skip: false })}>
              견적 없이 저장
            </Choice>
          </div>
        </div>
      )}
      {inv.kind === "수정" && inv.originalApprovalNo && (
        <p className="mt-2 text-[11px] text-muted-foreground">수정세금계산서 · 당초 {inv.originalApprovalNo} 와 한 묶음으로 셉니다</p>
      )}
    </div>
  )
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "touch-target rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

