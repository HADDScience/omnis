import type { ReactNode } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { usageReport, type PersonUsage } from "@/lib/ai-budget"
import { percentOf, type RunCostBasis } from "@/lib/ai-budget-rules"
import { RunsHint } from "./runs-hint"

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`
const pct = (used: number, limit: number | null) => {
  const p = limit === null ? null : percentOf(used, limit)
  return p === null ? "–" : `${p}%`
}

function Meter({ used, limit, label, hint }: { used: number; limit: number; label: string; hint?: ReactNode }) {
  const p = Math.min(percentOf(used, limit) ?? 0, 100)
  const tone = p >= 100 ? "bg-destructive" : p >= 80 ? "bg-amber-500" : "bg-primary"
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">
          {won(used)} / {won(limit)} <span className="text-muted-foreground">({pct(used, limit)})</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}>
        <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
      </div>
      {hint}
    </div>
  )
}

/** 「월 110,000원 ≈ 보통 대화 약 6,500번」 */
function MonthHint({ limit, basis }: { limit: number; basis: RunCostBasis }) {
  return <RunsHint krw={limit} basis={basis} lead={`월 ${won(limit)} ≈`} />
}

function PersonRow({ p }: { p: PersonUsage }) {
  return (
    <details className="group border-b py-2 last:border-b-0" data-ai-usage-person={p.userId ?? "none"}>
      <summary className="touch-target flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
        <span className="font-medium">{p.name}</span>
        <span className="tabular-nums text-muted-foreground">
          오늘 {won(p.todayKrw)}{p.limitKrw !== null && ` (${pct(p.todayKrw, p.limitKrw)})`} · 이번 달 {won(p.monthKrw)} · {p.monthCount.toLocaleString("ko-KR")}건
        </span>
      </summary>
      <table className="mt-2 w-full text-xs tabular-nums">
        <thead className="text-muted-foreground">
          <tr><th className="py-1 text-left font-normal">날짜</th><th className="text-right font-normal">건수</th><th className="text-right font-normal">비용</th><th className="text-right font-normal">하루 상한 대비</th></tr>
        </thead>
        <tbody>
          {p.days.map((d) => (
            <tr key={d.day}>
              <td className="py-0.5">{d.day.slice(5)}</td>
              <td className="text-right">{d.count.toLocaleString("ko-KR")}</td>
              <td className="text-right">{won(d.krw)}</td>
              <td className="text-right">{pct(d.krw, p.limitKrw)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

/**
 * AI 비용(이번 달) — 마이 → 사용량 탭 · 관리 화면. 원천은 AiUsage(에이전트 · 사진 설명 · Gemini 호출 전부).
 * 구성원은 자기 것만, 관리자는 전체 사람.
 */
export async function AiCostUsage({ userId, isAdmin, showAdminLink = true }: { userId: string; isAdmin: boolean; showAdminLink?: boolean }) {
  const report = await usageReport(isAdmin ? {} : { userId })
  const me = report.people.find((p) => p.userId === userId)
  const myLimit = me?.limitKrw ?? report.userDailyKrw
  return (
    <Card data-ai-cost-usage>
      <CardHeader>
        <CardTitle className="text-base">AI 사용량 ({report.month})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Meter
          label="오늘 내 사용"
          used={me?.todayKrw ?? 0}
          limit={myLimit}
          hint={<RunsHint krw={myLimit - (me?.todayKrw ?? 0)} basis={report.basis} lead="남은 한도: 오늘" more />}
        />
        <Meter
          label="이번 달 회사 전체"
          used={report.monthKrw}
          limit={report.monthlyKrw}
          hint={<MonthHint limit={report.monthlyKrw} basis={report.basis} />}
        />
        {report.people.length === 0 ? (
          <p className="text-sm text-muted-foreground">이번 달 AI 사용 기록이 아직 없습니다.</p>
        ) : (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">{isAdmin ? "사람별 — 눌러서 날짜별 보기" : "내 사용 — 눌러서 날짜별 보기"}</div>
            {report.people.map((p) => <PersonRow key={p.userId ?? "none"} p={p} />)}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          옴니스 대화 · 업무 카드 정리 · 검색 · 사진 설명 등 AI 를 부를 때마다 요금표로 환산한 값입니다(실제 청구와 다를 수 있음).
          한도에 닿으면 새 옴니스 대화만 멈추고, 쓰던 대화와 채팅은 그대로입니다.
        </p>
        {isAdmin && showAdminLink && (
          <Link href="/settings/ai-budget" className="touch-target inline-flex w-fit items-center text-sm font-medium underline underline-offset-4">
            상한 조정하기
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
