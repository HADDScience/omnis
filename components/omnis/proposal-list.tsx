"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon, Cancel01Icon, ArrowTurnBackwardIcon, SparklesIcon } from "@hugeicons/core-free-icons"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { apiUrl } from "@/lib/base-path"

/**
 * AI 가 올린 카드 갱신 제안 목록.
 *
 * 사람이 수락·거절한 기록이 그대로 자동 전환의 근거가 된다 — 위에 그 진행률을 보여 준다.
 * 설계: mydocs/plans/2026-09-10-ai-maintained-cards.md
 */

interface Section {
  title: string
  body: string
}

interface Proposal {
  id: string
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_APPLIED" | "SUPERSEDED"
  title: string
  reason: string
  content: { sections?: Section[] }
  sourceRefs: { kind: string; id: string; label: string }[]
  trigger: string
  revertedAt: string | null
  createdAt: string
  card: { id: string; title: string; category: { name: string } } | null
  category: { id: string; name: string } | null
  triggerTask: { id: string; name: string; slug: string } | null
  decidedBy: { name: string } | null
}

interface Stats {
  decided: number
  accepted: number
  rejected: number
  rate: number | null
  auto: boolean
  needMore: number
  pending: number
  autoApplied: number
  thresholds: { minDecided: number; window: number; minRate: number }
}

const STATUS_LABEL: Record<Proposal["status"], string> = {
  PENDING: "확인 대기",
  ACCEPTED: "수락됨",
  REJECTED: "거절됨",
  AUTO_APPLIED: "자동 반영됨",
  SUPERSEDED: "더 새 제안으로 대체됨",
}

export function ProposalList() {
  const [tab, setTab] = useState<"PENDING" | "decided">("PENDING")
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async (which: "PENDING" | "decided") => {
    setLoading(true)
    try {
      const res = await fetch(apiUrl(`/api/omnis/proposals?status=${which}`))
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "목록을 불러오지 못했습니다")
      setProposals(data.proposals)
      setStats(data.stats)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tab)
  }, [tab, load])

  const decide = async (id: string, action: "accept" | "reject" | "revert") => {
    setBusy(id)
    try {
      const res = await fetch(apiUrl("/api/omnis/proposals"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "처리하지 못했습니다")
      setStats(data.stats)
      toast.success(action === "accept" ? "카드에 반영했습니다" : action === "reject" ? "거절했습니다" : "되돌렸습니다")
      await load(tab)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "오류가 발생했습니다")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {stats && <StatsBar stats={stats} />}

      <div className="flex gap-1.5">
        {(["PENDING", "decided"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-3 py-1 text-[12px] transition-colors ${
              tab === t ? "border-border-strong bg-muted" : "hover:bg-muted/60"
            }`}
          >
            {t === "PENDING" ? `확인 대기${stats ? ` ${stats.pending}` : ""}` : "처리한 것"}
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
            ? "확인할 제안이 없습니다. 업무가 완료되면 AI 가 그 대화에서 회사 지식을 찾아 올립니다."
            : "아직 처리한 제안이 없습니다."}
        </p>
      ) : (
        proposals.map((p) => (
          <ProposalCard key={p.id} p={p} busy={busy === p.id} onDecide={decide} />
        ))
      )}
    </div>
  )
}

function StatsBar({ stats }: { stats: Stats }) {
  const pct = stats.rate === null ? null : Math.round(stats.rate * 100)
  const target = Math.round(stats.thresholds.minRate * 100)
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={SparklesIcon} size={16} className="text-primary" />
        <span className="text-[13.5px] font-semibold">
          {stats.auto ? "자동 반영 중" : "제안 → 사람이 확인"}
        </span>
        <span className="ml-auto text-[12px] text-muted-foreground">
          {pct === null ? "판단 기록 없음" : `수락률 ${pct}%`} · 판단 {stats.decided}건
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {stats.auto ? (
          <>
            최근 {stats.decided}건 중 {stats.accepted}건을 수락해 수락률이 {pct}% 입니다. 기준({target}% ·{" "}
            {stats.thresholds.minDecided}건)을 넘어 지금은 AI 가 카드를 바로 반영합니다. 틀린 것은 「처리한 것」에서
            되돌릴 수 있고, 되돌리면 수락률에 반영돼 다시 확인 방식으로 돌아갑니다.
          </>
        ) : stats.needMore > 0 ? (
          <>
            판단이 {stats.thresholds.minDecided}건 쌓이고 수락률이 {target}% 를 넘으면 AI 가 카드를 바로 반영합니다.
            {stats.needMore}건 더 판단하면 기준을 검토합니다.
          </>
        ) : (
          <>
            판단은 충분히 쌓였지만 수락률이 {pct}% 로 기준({target}%)에 못 미칩니다. 제안 방식을 유지합니다.
          </>
        )}
      </p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${stats.auto ? "bg-primary" : "bg-muted-foreground/40"}`}
          style={{ width: `${Math.min(100, (stats.decided / stats.thresholds.minDecided) * 100)}%` }}
        />
      </div>
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
  onDecide: (id: string, action: "accept" | "reject" | "revert") => void
}) {
  const sections = p.content?.sections ?? []
  const isNew = !p.card
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
          {isNew ? `새 카드 · ${p.category?.name ?? "분류 없음"}` : `수정 · ${p.card?.category.name}`}
        </span>
        {p.status !== "PENDING" && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {STATUS_LABEL[p.status]}
            {p.revertedAt ? " (되돌림)" : ""}
            {p.decidedBy ? ` · ${p.decidedBy.name}` : ""}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">
          {new Date(p.createdAt).toLocaleDateString("ko-KR")}
        </span>
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug">{p.title}</h3>
      {p.reason && <p className="mt-1 text-[12.5px] text-muted-foreground">{p.reason}</p>}

      <div className="mt-3 space-y-2.5 rounded-lg bg-muted/40 p-3">
        {sections.map((s, i) => (
          <div key={i}>
            {s.title && <div className="text-[12.5px] font-semibold">{s.title}</div>}
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[11.5px] text-muted-foreground">근거</span>
        {p.triggerTask ? (
          <Link
            href={`/tasks/${p.triggerTask.id}`}
            className="rounded-full border px-2 py-0.5 text-[11.5px] hover:bg-muted"
          >
            #{p.triggerTask.slug}
          </Link>
        ) : (
          p.sourceRefs?.map((r, i) => (
            <span key={i} className="rounded-full border px-2 py-0.5 text-[11.5px]">
              {r.label}
            </span>
          ))
        )}
        {p.card && (
          <Link href={`/omnis/${p.card.id}`} className="rounded-full border px-2 py-0.5 text-[11.5px] hover:bg-muted">
            지금 카드 보기
          </Link>
        )}
      </div>

      <div className="mt-3.5 flex gap-2">
        {p.status === "PENDING" ? (
          <>
            <Button size="sm" disabled={busy} onClick={() => onDecide(p.id, "accept")} className="gap-1.5">
              {busy ? <Spinner /> : <HugeiconsIcon icon={CheckmarkCircle02Icon} size={14} />}
              카드에 반영
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(p.id, "reject")} className="gap-1.5">
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
              필요 없음
            </Button>
          </>
        ) : (p.status === "AUTO_APPLIED" || p.status === "ACCEPTED") && !p.revertedAt ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide(p.id, "revert")} className="gap-1.5">
            {busy ? <Spinner /> : <HugeiconsIcon icon={ArrowTurnBackwardIcon} size={14} />}
            되돌리기
          </Button>
        ) : null}
      </div>
    </div>
  )
}
