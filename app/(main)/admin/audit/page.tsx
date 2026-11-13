import type { Metadata } from "next"

import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { requireAdminPage } from "@/lib/admin-access-server"
import { loadAdminAudit } from "@/lib/admin-users-server"

export const metadata: Metadata = { title: "기록" }
export const dynamic = "force-dynamic"

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })

/** 관리자 행동 감사 기록 — 누가 · 언제 · 무엇. ActivityLog 를 그대로 읽는다(lib/admin-users-server.ts 의 loadAdminAudit) */
export default async function AdminAuditPage() {
  await requireAdminPage()
  const rows = await loadAdminAudit()

  return (
    <section aria-labelledby="admin-audit-title" className="glass rounded-2xl p-4" data-admin-audit>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 id="admin-audit-title" className="text-base font-semibold">관리자 행동 기록</h1>
        <p className="text-[12.5px] text-muted-foreground">최근 {rows.length}건 · 잠금 해제 · 온보딩 다시 띄우기 · AI 비용 상한 · 기능 요청 상태</p>
      </div>
      {rows.length === 0 ? (
        <Empty className="rounded-xl border border-dashed">
          <EmptyHeader>
            <EmptyTitle>아직 기록이 없습니다</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="flex flex-col divide-y text-[13px]">
          {rows.map((r) => (
            <li key={r.id} data-audit-action={r.action} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:gap-3">
              <span className="shrink-0 text-muted-foreground tabular-nums sm:w-[7.5rem]">{dateTime.format(new Date(r.at))}</span>
              <span className="shrink-0 font-medium sm:w-20 sm:truncate">{r.actor}</span>
              <span className="min-w-0 break-words">{r.title}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
