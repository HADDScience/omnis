import { FeatureStatusButtons } from "@/components/settings/feature-status"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { FEATURE_STATUS_LABEL, listFeatureRequests } from "@/lib/feature-requests"

const dateTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "short" })

/** 기능 요청 목록 — /settings/feature-requests 와 /admin/operations 가 같이 쓴다. 권한은 부르는 화면이 본다 */
export async function FeatureRequestsSection() {
  const rows = await listFeatureRequests()
  const counts = { NEW: 0, REVIEW: 0, DONE: 0 }
  for (const r of rows) counts[r.status]++

  return (
    <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          옴니스가 대화 중 「지금 없는 기능」 이라 들어주지 못한 요청입니다. 요청한 사람이 확인한 것만 옵니다. 같은 요청은 한 줄로 묶입니다.
          {" "}새로 {counts.NEW} · 검토 {counts.REVIEW} · 완료 {counts.DONE}
        </p>
        {rows.length === 0 && (
          <Empty className="rounded-xl border border-dashed">
            <EmptyHeader>
              <EmptyTitle>아직 요청이 없습니다</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.id} data-feature-request={r.id} data-status={r.status} className="rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{r.title}</h2>
                  <p className="text-xs text-muted-foreground">
                    {FEATURE_STATUS_LABEL[r.status]} · 요청 {r.count}건 · 처음 {dateTime.format(r.createdAt)} · 마지막 {dateTime.format(r.updatedAt)}
                  </p>
                </div>
                <FeatureStatusButtons id={r.id} status={r.status} />
              </div>
              <ul className="mt-3 flex flex-col gap-2 border-t pt-3">
                {r.entries.map((e) => (
                  <li key={e.id} className="text-sm">
                    <div className="text-xs text-muted-foreground">
                      {e.requester.name} · {dateTime.format(e.createdAt)}
                      {e.roomId && <span> · 옴니스 대화 {e.roomId.slice(0, 8)}(요청한 사람만 열림)</span>}
                    </div>
                    <p className="whitespace-pre-wrap">{e.detail}</p>
                    {e.attempted && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">옴니스가 해 본 것: {e.attempted}</p>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
    </div>
  )
}
