import type { Metadata } from "next"

import { Header } from "@/components/layout/header"
import { PilotMetrics } from "@/components/settings/pilot-metrics"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { auth } from "@/lib/auth"
import { UI_METRICS_NOTICE } from "@/lib/ui-metrics/notice"
import type { UiMetricRow } from "@/lib/ui-metrics/rules"
import { loadPilotView, parsePilotFilter } from "@/lib/ui-metrics/pilot-server"
import { loadUiMetricsSummary } from "@/lib/ui-metrics/server"

export const metadata: Metadata = { title: "UI 변경 측정" }
export const dynamic = "force-dynamic"

const seconds = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)}초`)
const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })

const CELL = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums"
const HEADERS = ["방 → 첫 글", "방 → 첫 글(저장본)", "첫 전송 중앙값", "전송", "첨부 실패", "재시도", "메뉴 닫기/열기", "+ 닫기/열기", "+ 사용", "단축키"]

function MetricCells({ row }: { row: UiMetricRow }) {
  const c = row.counts
  return (
    <>
      <td className={CELL}>{seconds(row.firstMessageMs)}</td>
      <td className={CELL}>{seconds(row.firstMessageSavedMs)}</td>
      <td className={CELL}>{seconds(row.medianMs)}</td>
      <td className={CELL}>{row.sends}</td>
      <td className={CELL}>{c.attachFailed}</td>
      <td className={CELL}>{c.attachRetry}</td>
      <td className={CELL}>{c.menuDismiss}/{c.menuOpen}</td>
      <td className={CELL}>{c.plusDismiss}/{c.plusOpen}</td>
      <td className={CELL}>{c.plusAct}</td>
      <td className={CELL}>{c.shortcut}</td>
    </>
  )
}

/** 배포별 · 사람별 측정. 관리자만 연다. 같은 값을 GET /api/ui-metrics/summary 로도 받는다 */
export default async function UiMetricsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await auth()
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "ADMIN"

  if (!isAdmin) {
    return (
      <>
        <Header crumbs={["마이", "UI 변경 측정"]} />
        <div className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>관리자만 볼 수 있습니다</EmptyTitle>
              <EmptyDescription>사람별 사용 기록이 있어 관리자 계정에만 열려 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </>
    )
  }

  const filter = parsePilotFilter(await searchParams)
  const [deployments, pilot] = await Promise.all([loadUiMetricsSummary(), loadPilotView(filter)])

  return (
    <>
      <Header crumbs={["마이", "UI 변경 측정"]} />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">{UI_METRICS_NOTICE.usage}</p>
        <PilotMetrics view={pilot} filter={filter} />
        {deployments.length === 0 && (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>아직 기록이 없습니다</EmptyTitle>
              <EmptyDescription>마이그레이션을 적용하고 배포하면 쌓이기 시작합니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {deployments.map((d) => (
          <section key={d.sha} className="flex flex-col gap-2 border-b pb-5" data-ui-deployment={d.sha}>
            <h2 className="text-sm font-semibold">
              <span className="font-mono">{d.sha.slice(0, 7)}</span>
              <span className="ml-2 font-normal text-muted-foreground">처음 쓰임 {dateTime.format(new Date(d.firstSeenAt))}</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              점수 중앙값 {d.medianScore ?? "–"} · 답 {d.answers} · 닫음 {d.dismissals}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">사람</th>
                    <th scope="col" className={`${CELL} font-medium`}>점수</th>
                    {HEADERS.map((h) => (
                      <th key={h} scope="col" className={`${CELL} font-medium`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b font-medium">
                    <th scope="row" className="px-2 py-1.5 text-left font-medium">전체</th>
                    <td className={CELL}>{d.medianScore ?? "–"}</td>
                    <MetricCells row={d} />
                  </tr>
                  {d.people.map((p) => (
                    <tr key={p.userId} className="border-b last:border-b-0">
                      <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal">
                        {p.name}
                        {p.comment && <span className="block whitespace-normal text-[12px] text-muted-foreground">{p.comment}</span>}
                      </th>
                      <td className={CELL}>{p.score ?? (p.dismissed ? "닫음" : "–")}</td>
                      <MetricCells row={p} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
