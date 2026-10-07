"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"
import { RECORD_KINDS, RECORD_KIND_LABEL } from "@/lib/schemas/company"

/**
 * AI 가 채팅 · 업무에서 찾은 연혁 후보 — 채택 · 고쳐서 채택 · 제외.
 *
 * 원안 그대로 채택한 비율이 종류 × 등급별로 쌓여 자동 등록의 근거가 된다. 그래서 고칠 때는
 * 「고쳐서 채택」으로 따로 남긴다 — 고친 채택은 원안과 다름으로 센다.
 * 설계: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md
 */

type Kind = (typeof RECORD_KINDS)[number]
type Grade = "MAJOR" | "GENERAL"

interface Ref {
  kind: "task" | "message"
  id: string
  label: string
  at?: string
  quote?: string
}

interface Proposal {
  id: string
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_APPLIED" | "SUPERSEDED"
  kind: Kind
  grade: Grade
  confidential: boolean
  title: string
  organizer: string | null
  occurredOn: string | null
  periodRaw: string | null
  confidence: number
  reason: string
  sourceRefs: Ref[]
  edited: boolean
  revertedAt: string | null
  decidedAt: string | null
  triggerTask: { id: string; name: string; slug: string } | null
  decidedBy: { name: string } | null
  record: { id: string; title: string } | null
}

interface TypeStat {
  kind: Kind
  grade: Grade
  decided: number
  matched: number
  rate: number | null
  streak: number
  auto: boolean
}

// 종류 「주요」(MILESTONE)와 겹쳐 읽히지 않게 등급은 쓰임새로 부른다
const GRADE_LABEL: Record<Grade, string> = { MAJOR: "기업현황카드 후보", GENERAL: "상세 연혁" }
const STATUS_LABEL: Record<Proposal["status"], string> = {
  PENDING: "확인 대기",
  ACCEPTED: "채택",
  REJECTED: "제외",
  AUTO_APPLIED: "자동 등록",
  SUPERSEDED: "대체됨",
}

export function RecordProposalList() {
  const [tab, setTab] = useState<"PENDING" | "decided">("PENDING")
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [stats, setStats] = useState<TypeStat[]>([])
  const [pending, setPending] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (which: "PENDING" | "decided") => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/company/record-proposals?status=${which}`))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "목록을 불러오지 못했습니다")
      setProposals(data.proposals)
      setStats(data.stats)
      setPending(data.pending)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  const decide = async (id: string, action: "accept" | "reject" | "revert", edits?: Record<string, unknown>) => {
    setBusy(id)
    try {
      const res = await fetch(apiUrl("/api/company/record-proposals"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, edits }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다")
      toast.success(action === "accept" ? (edits ? "고쳐서 연혁에 넣었습니다" : "연혁에 넣었습니다") : action === "reject" ? "제외했습니다" : "되돌렸습니다")
      await load(tab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <StatsBox stats={stats} />

      <div className="flex gap-1.5" role="tablist" aria-label="연혁 후보 보기">
        {(["PENDING", "decided"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`touch-target rounded-full border px-3 py-1 text-[12px] transition-colors ${
              tab === t ? "border-border-strong bg-muted" : "hover:bg-muted/60"
            }`}
          >
            {t === "PENDING" ? `확인 대기${pending !== null ? ` ${pending}` : ""}` : "처리한 것"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : proposals.length === 0 ? (
        <p className="rounded-xl border bg-card px-5 py-10 text-center text-[13px] text-muted-foreground">
          {tab === "PENDING"
            ? "확인할 연혁 후보가 없습니다. 매일 새벽 전날 채팅을, 업무가 끝나면 그 대화를 AI 가 살펴 올립니다."
            : "아직 처리한 후보가 없습니다."}
        </p>
      ) : (
        proposals.map((p) => <ProposalCard key={p.id} p={p} busy={busy === p.id} onDecide={decide} />)
      )}
    </div>
  )
}

function StatsBox({ stats }: { stats: TypeStat[] }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-[12px] leading-relaxed text-muted-foreground">
      <p>
        원안 그대로 채택한 비율을 종류 × 등급별로 셉니다. <b className="text-foreground">상세 연혁</b>은 판단 20건 이상 · 90% 이상 ·
        최근 3건 연속이면 그 유형만 자동 등록으로 넘어갑니다. <b className="text-foreground">기업현황카드 후보와 대외비는 계속 사람이 확인합니다.</b>
      </p>
      {stats.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {stats.map((s) => (
            <li key={`${s.kind}:${s.grade}`} className="rounded-full border px-2 py-0.5 text-[11.5px]">
              {RECORD_KIND_LABEL[s.kind]} · {GRADE_LABEL[s.grade]} — {s.matched}/{s.decided}
              {s.rate !== null && ` (${Math.round(s.rate * 100)}%)`}
              {s.auto && <span className="ml-1 font-semibold text-primary">자동 등록 중</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProposalCard({
  p,
  busy,
  onDecide,
}: {
  p: Proposal
  busy: boolean
  onDecide: (id: string, action: "accept" | "reject" | "revert", edits?: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: p.title,
    occurredOn: p.occurredOn?.slice(0, 10) ?? "",
    kind: p.kind,
    grade: p.grade,
    confidential: p.confidential,
    organizer: p.organizer ?? "",
  })
  const messages = p.sourceRefs.filter((r) => r.kind === "message")

  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {p.occurredOn ? p.occurredOn.slice(0, 10).replaceAll("-", ".") : (p.periodRaw ?? "날짜 모름")}
        </span>
        <Badge variant="outline">{RECORD_KIND_LABEL[p.kind]}</Badge>
        <Badge variant={p.grade === "MAJOR" ? "default" : "secondary"}>{GRADE_LABEL[p.grade]}</Badge>
        {p.confidential && <Badge variant="destructive">대외비</Badge>}
        {p.status !== "PENDING" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {STATUS_LABEL[p.status]}
            {p.edited ? " (고쳐서)" : ""}
            {p.revertedAt ? " · 되돌림" : ""}
            {p.decidedBy ? ` · ${p.decidedBy.name}` : ""}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">확신 {Math.round(p.confidence * 100)}%</span>
      </div>

      <h3 className="mt-2 break-words text-[15px] font-semibold leading-snug">{p.title}</h3>
      {p.organizer && <p className="text-[12.5px] text-muted-foreground">{p.organizer}</p>}
      {p.reason && <p className="mt-1 text-[12.5px] text-muted-foreground">{p.reason}</p>}

      {messages.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-lg bg-muted/40 p-3">
          {messages.slice(0, 3).map((r) => (
            <li key={r.id} className="text-[12px] leading-relaxed">
              <span className="text-muted-foreground">{r.label}</span>{" "}
              <span className="break-words">{r.quote}</span>
            </li>
          ))}
        </ul>
      )}

      {p.triggerTask && (
        <Link href={`/tasks/${p.triggerTask.id}`} className="touch-target mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] hover:bg-muted">
          업무 #{p.triggerTask.slug}
        </Link>
      )}

      {editing && p.status === "PENDING" && (
        <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-lg border p-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor={`rp-title-${p.id}`} className="mb-1 block text-[12px]">제목</Label>
            <Input id={`rp-title-${p.id}`} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`rp-date-${p.id}`} className="mb-1 block text-[12px]">날짜</Label>
            <Input id={`rp-date-${p.id}`} type="date" value={form.occurredOn} onChange={(e) => setForm({ ...form, occurredOn: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`rp-org-${p.id}`} className="mb-1 block text-[12px]">주관</Label>
            <Input id={`rp-org-${p.id}`} value={form.organizer} onChange={(e) => setForm({ ...form, organizer: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`rp-kind-${p.id}`} className="mb-1 block text-[12px]">종류</Label>
            <select
              id={`rp-kind-${p.id}`}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}
              className="h-9 w-full rounded-md border bg-background px-2 text-[13px]"
            >
              {RECORD_KINDS.map((k) => (
                <option key={k} value={k}>{RECORD_KIND_LABEL[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor={`rp-grade-${p.id}`} className="mb-1 block text-[12px]">등급</Label>
            <select
              id={`rp-grade-${p.id}`}
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value as Grade })}
              className="h-9 w-full rounded-md border bg-background px-2 text-[13px]"
            >
              <option value="MAJOR">기업현황카드 후보 — 기관 확정 성과</option>
              <option value="GENERAL">상세 연혁 — 참석 · 발표 · 교육</option>
            </select>
          </div>
          <label className="touch-target flex items-center gap-2 text-[12.5px] sm:col-span-2">
            <input type="checkbox" checked={form.confidential} onChange={(e) => setForm({ ...form, confidential: e.target.checked })} />
            대외비 — 외부 자료에 쓰지 않음
          </label>
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap gap-2">
        {p.status === "PENDING" ? (
          editing ? (
            <>
              <Button size="sm" className="touch-target" disabled={busy || !form.title.trim()} onClick={() => onDecide(p.id, "accept", { ...form, occurredOn: form.occurredOn || null })}>
                {busy && <Spinner />} 고친 대로 넣기
              </Button>
              <Button size="sm" className="touch-target" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                취소
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" className="touch-target" disabled={busy} onClick={() => onDecide(p.id, "accept")}>
                {busy && <Spinner />} 채택
              </Button>
              <Button size="sm" className="touch-target" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                고쳐서 채택
              </Button>
              <Button size="sm" className="touch-target" variant="ghost" disabled={busy} onClick={() => onDecide(p.id, "reject")}>
                제외
              </Button>
            </>
          )
        ) : (
          <>
            {p.record && (
              <Link href={`/omnis/records#rec-${p.record.id}`} className="touch-target inline-flex items-center rounded-md border px-2.5 text-[12px] hover:bg-muted">
                연혁에서 보기
              </Link>
            )}
            {(p.status === "ACCEPTED" || p.status === "AUTO_APPLIED") && !p.revertedAt && (
              <Button size="sm" className="touch-target" variant="ghost" disabled={busy} onClick={() => onDecide(p.id, "revert")}>
                {busy && <Spinner />} 되돌리기
              </Button>
            )}
          </>
        )}
      </div>
    </article>
  )
}
