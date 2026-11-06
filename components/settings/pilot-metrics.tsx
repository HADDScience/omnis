import type { PilotFilter, PilotView } from "@/lib/ui-metrics/pilot-server"

/**
 * /settings/ui-metrics 의 「시범 운영」 칸 — 카톡 → 옴니스 시범 운영을 주 단위로 본다. 관리자 화면에서만 그린다.
 * 필터는 GET 폼이라 화면 스크립트가 없다. 계획: mydocs/plans/2026-11-06-pilot-metrics.md
 */

const CELL = "whitespace-nowrap px-2 py-1.5 text-right tabular-nums"
const HEAD = `${CELL} font-medium`
const ROOM_ROWS = 30

const weekLabel = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`)
function secs(v: number | null): string {
  if (v === null) return "–"
  if (v < 60) return `${v}초`
  if (v < 3600) return `${Math.round(v / 60)}분`
  return `${(v / 3600).toFixed(1)}시간`
}

export function PilotMetrics({ view, filter }: { view: PilotView; filter: PilotFilter }) {
  const people = new Map(view.names.people.map((p) => [p.id, p.name]))
  const rooms = new Map(view.names.rooms.map((r) => [r.id, r.name]))
  const weeks = view.weeks.map((w) => weekLabel.format(new Date(w.week)))

  return (
    <section className="flex flex-col gap-3 border-b pb-6" data-pilot-metrics>
      <h2 className="text-base font-semibold">시범 운영</h2>
      <p className="text-sm text-muted-foreground">
        카톡 → 옴니스 시범 운영을 주(월요일 시작, 한국 시간) 단위로 봅니다. 사람 필터는 모든 값에, 방 필터는 글 수에만 걸립니다.
        푸시 받기 · 열기 시간은 기기 시계로 잰 값입니다.
      </p>

      <form method="get" className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">사람</span>
          <select name="person" defaultValue={filter.userId ?? ""} className="h-9 rounded-md border bg-background px-2" data-pilot-filter="person">
            <option value="">전체</option>
            {view.names.people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">방</span>
          <select name="room" defaultValue={filter.roomId ?? ""} className="h-9 max-w-[16rem] rounded-md border bg-background px-2" data-pilot-filter="room">
            <option value="">전체</option>
            {view.names.rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border px-3 font-medium hover:bg-muted">보기</button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" data-pilot-weeks>
          <thead className="text-muted-foreground">
            <tr className="border-b">
              <th scope="col" className="px-2 py-1.5 text-left font-medium">주</th>
              <th scope="col" className={HEAD}>푸시 보냄</th>
              <th scope="col" className={HEAD}>받음</th>
              <th scope="col" className={HEAD}>받기 중앙 / 90%</th>
              <th scope="col" className={HEAD}>열기 중앙</th>
              <th scope="col" className={HEAD}>직접 글</th>
              <th scope="col" className={HEAD}>카톡 글</th>
              <th scope="col" className={HEAD}>카톡 비율</th>
              <th scope="col" className={HEAD}>옴니스 질문</th>
              <th scope="col" className={HEAD}>사진 답</th>
              <th scope="col" className={HEAD}>검색</th>
              <th scope="col" className={HEAD}>사진 검색</th>
              <th scope="col" className={HEAD}>쓴 사람</th>
              <th scope="col" className={HEAD}>사람·날</th>
            </tr>
          </thead>
          <tbody>
            {view.weeks.map((w, i) => (
              <tr key={w.week} className="border-b last:border-b-0" data-pilot-week={w.week}>
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal">{weeks[i]}~</th>
                <td className={CELL}>{w.push.sent}</td>
                <td className={CELL}>{w.push.received} ({pct(w.push.receivedRate)})</td>
                <td className={CELL}>{secs(w.push.medianReceiveS)} / {secs(w.push.p90ReceiveS)}</td>
                <td className={CELL}>{secs(w.push.medianOpenS)} ({w.push.opened})</td>
                <td className={CELL} data-pilot-direct>{w.messages.direct}</td>
                <td className={CELL} data-pilot-kakao>{w.messages.kakao}</td>
                <td className={CELL}>{pct(w.messages.kakaoShare)}</td>
                <td className={CELL}>{w.omnisAsks}</td>
                <td className={CELL}>{w.photoAnswers}</td>
                <td className={CELL}>{w.searches}</td>
                <td className={CELL}>{w.photoSearches}</td>
                <td className={CELL}>{w.activePeople}</td>
                <td className={CELL}>{w.activePersonDays}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-2 text-sm font-semibold">방별 글 수 (직접 / 카톡)</h3>
      {view.rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">이 기간에 글이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-pilot-rooms>
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-2 py-1.5 text-left font-medium">방</th>
                {weeks.map((w) => (
                  <th key={w} scope="col" className={HEAD}>{w}~</th>
                ))}
                <th scope="col" className={HEAD}>카톡 비율</th>
              </tr>
            </thead>
            <tbody>
              {view.rooms.slice(0, ROOM_ROWS).map((r) => (
                <tr key={r.roomId} className="border-b last:border-b-0" data-pilot-room={r.roomId}>
                  <th scope="row" className="max-w-[14rem] truncate whitespace-nowrap px-2 py-1.5 text-left font-normal">
                    {rooms.get(r.roomId) ?? "(지운 방)"}
                  </th>
                  {r.weeks.map((c, i) => (
                    <td key={i} className={CELL}>{c.direct || c.kakao ? `${c.direct} / ${c.kakao}` : "–"}</td>
                  ))}
                  <td className={CELL}>{pct(r.direct + r.kakao ? r.kakao / (r.direct + r.kakao) : null)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="mt-2 text-sm font-semibold">사람별 쓴 날 (주마다 0~7)</h3>
      {view.people.length === 0 ? (
        <p className="text-sm text-muted-foreground">이 기간에 쓴 사람이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" data-pilot-people>
            <thead className="text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="px-2 py-1.5 text-left font-medium">사람</th>
                {weeks.map((w) => (
                  <th key={w} scope="col" className={HEAD}>{w}~</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...view.people]
                .map((p) => ({ ...p, name: people.get(p.userId) ?? "(지운 계정)" }))
                .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                .map((p) => (
                  <tr key={p.userId} className="border-b last:border-b-0" data-pilot-person={p.userId}>
                    <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal">{p.name}</th>
                    {p.weeks.map((d, i) => (
                      <td key={i} className={CELL}>{d}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
