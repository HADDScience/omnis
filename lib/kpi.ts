// 운영 KPI — 하루치 지표를 계산해 KpiDaily 에 쌓는다.
//
// 「옴니스가 제 역할을 하는가」를 매번 손 쿼리로 묻지 않으려고 하루 크론(app/api/cron/daily)이 쌓아 둔다.
// 정의와 고른 이유는 mydocs/plans/2026-10-16-kpi-metrics.md 가 정본이다. 지표를 늘릴 때 마이그레이션은 없다 —
// 여기 계산을 하나 더하면 된다.
import { prisma } from "@/lib/db"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { Prisma } from "@/generated/prisma/client"

export interface KpiRow {
  key: string
  value: number
  detail?: Prisma.InputJsonValue
}

/** 한국 날짜 "YYYY-MM-DD". */
export function kstDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
}

function dayWindow(day: string): [Date, Date] {
  const start = new Date(`${day}T00:00:00+09:00`)
  return [start, new Date(start.getTime() + 86_400_000)]
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const round = (x: number, n = 2) => Math.round(x * 10 ** n) / 10 ** n

/**
 * 하루치 지표.
 * - `withEvents`: 업무 변경 이력(TaskEvent)으로 세는 지표를 넣을지. 이력이 쌓이기 전 날짜에 넣으면 「0건」이 거짓말이 된다.
 * - `withSnapshot`: 「지금 열린 업무」처럼 그날이 아니라 계산하는 순간의 상태를 넣을지. 막 끝난 날에만 넣는다.
 */
export async function computeDailyKpis(
  day: string,
  opts: { withEvents: boolean; withSnapshot: boolean }
): Promise<KpiRow[]> {
  const [s, e] = dayWindow(day)
  const rows: KpiRow[] = []

  // ── 채택: 메시지 — 직접 입력은 카톡에서 옮긴 것(sourceId)과 🤖 시스템 글을 뺀 사람의 글
  const [msg] = await prisma.$queryRaw<{ native: number; imported: number; total: number; linked: number }[]>`
    select count(*) filter (where "sourceId" is null and "authorId" <> ${SYSTEM_USER_ID} and kind = 'NORMAL')::int native,
           count(*) filter (where "sourceId" like 'kakao%')::int imported,
           count(*) filter (where kind = 'NORMAL')::int total,
           count(*) filter (where kind = 'NORMAL' and "taskId" is not null)::int linked
    from "ChatMessage" where "deletedAt" is null and "createdAt" >= ${s} and "createdAt" < ${e}`
  rows.push({ key: "messages.native", value: msg.native }, { key: "messages.imported", value: msg.imported })
  // 잡담은 업무에 붙지 않는 게 맞아 100% 가 목표는 아니다. 갑자기 떨어지면 연결이 새는 신호다
  if (msg.total > 0) rows.push({ key: "messages.linkedRate", value: round(msg.linked / msg.total, 4), detail: { linked: msg.linked, total: msg.total } })

  // ── 채택: 그날 직접 쓴 사람 — 채팅 · 업무 변경(사람 경로) · 옴니스 질문 중 하나라도.
  // 이력을 안 볼 때는 TaskEvent 를 읽지 않는다 — 표가 아직 없는 DB(마이그레이션 전)에서도 돌게
  const byEvents = opts.withEvents
    ? Prisma.sql`union select "actorId" from "TaskEvent"
        where via in ('web', 'mcp', 'notification') and "createdAt" >= ${s} and "createdAt" < ${e}`
    : Prisma.empty
  const active = await prisma.$queryRaw<{ name: string }[]>`
    select u.name from "User" u where u.id <> ${SYSTEM_USER_ID} and u.id in (
      select "authorId" from "ChatMessage"
        where "sourceId" is null and kind = 'NORMAL' and "deletedAt" is null and "createdAt" >= ${s} and "createdAt" < ${e}
      ${byEvents}
      union select "userId" from "OmnisQuery" where "createdAt" >= ${s} and "createdAt" < ${e})
    order by u.name`
  rows.push({ key: "users.active", value: active.length, detail: { names: active.map((u) => u.name) } })

  // ── 추적: 그날 생긴 업무 카드
  const [created] = await prisma.$queryRaw<{ native: number; imported: number }[]>`
    select count(*) filter (where "sourceId" is null or "sourceId" not like 'kakao-task:%')::int native,
           count(*) filter (where "sourceId" like 'kakao-task:%')::int imported
    from "Task" where "createdAt" >= ${s} and "createdAt" < ${e}`
  rows.push({ key: "tasks.created.native", value: created.native }, { key: "tasks.created.imported", value: created.imported })

  // ── 추적 · AI: 상태 변경 이력
  if (opts.withEvents) {
    const ev = await prisma.$queryRaw<{ taskId: string; via: string; before: unknown; after: unknown; at: Date; taskCreatedAt: Date }[]>`
      select ev."taskId", ev.via, ev.before, ev.after, ev."createdAt" at, t."createdAt" "taskCreatedAt"
      from "TaskEvent" ev join "Task" t on t.id = ev."taskId"
      where ev.field = 'status' and ev."createdAt" >= ${s} and ev."createdAt" < ${e}`
    const byVia: Record<string, number> = {}
    for (const x of ev) byVia[x.via] = (byVia[x.via] ?? 0) + 1
    rows.push({ key: "tasks.statusChanges", value: ev.length, detail: byVia })

    // 같은 업무가 하루에 두 번 완료되면(되돌렸다 다시) 마지막 것만 센다
    const done = new Map<string, (typeof ev)[number]>()
    for (const x of ev) if (x.after === "DONE") done.set(x.taskId, x)
    const doneVia: Record<string, number> = {}
    for (const x of done.values()) doneVia[x.via] = (doneVia[x.via] ?? 0) + 1
    rows.push({ key: "tasks.done", value: done.size, detail: doneVia })
    const lead = median([...done.values()].map((x) => (x.at.getTime() - x.taskCreatedAt.getTime()) / 86_400_000))
    if (lead !== null) rows.push({ key: "tasks.leadtime.p50", value: round(lead), detail: { tasks: done.size } })

    // 완료였다가 다시 열린 것 — 채팅 AI 재구성이 완료 업무를 진행 중으로 되돌리는 길이 있다(lib/chat-post.ts)
    const reopened = ev.filter((x) => x.before === "DONE" && x.after !== "DONE")
    const reopenedVia: Record<string, number> = {}
    for (const x of reopened) reopenedVia[x.via] = (reopenedVia[x.via] ?? 0) + 1
    rows.push({ key: "tasks.reopened", value: reopened.length, detail: reopenedVia })
  }

  // ── 추적: 계산하는 순간의 업무 상태
  if (opts.withSnapshot) {
    const [snap] = await prisma.$queryRaw<{ open: number; stale30: number; doneOpenChecklist: number }[]>`
      with t as (
        select t.id, t.status::text status, coalesce(max(m."createdAt"), t."createdAt") last_at,
               count(c.id) filter (where not c.done) open_items
        from "Task" t
        left join "ChatMessage" m on m."taskId" = t.id and m."deletedAt" is null
        left join "Checklist" c on c."taskId" = t.id
        where not t.archived group by t.id)
      select count(*) filter (where status <> 'DONE')::int open,
             count(*) filter (where status <> 'DONE' and last_at < now() - interval '30 days')::int stale30,
             count(*) filter (where status = 'DONE' and open_items > 0)::int "doneOpenChecklist"
      from t`
    rows.push(
      { key: "tasks.open", value: snap.open },
      { key: "tasks.stale30", value: snap.stale30 },
      { key: "tasks.doneOpenChecklist", value: snap.doneOpenChecklist }
    )
  }

  // ── 알림: 응답이 필요한 알림과 응답까지 걸린 시간
  const [notif] = await prisma.$queryRaw<{ actionable: number; resolved: number }[]>`
    select count(*)::int actionable, count(*) filter (where "resolvedAt" is not null)::int resolved
    from "Notification" where "actionType" is not null and "createdAt" >= ${s} and "createdAt" < ${e}`
  rows.push(
    { key: "notifications.actionable", value: notif.actionable },
    { key: "notifications.resolved", value: notif.resolved }
  )
  const answered = await prisma.$queryRaw<{ hours: number }[]>`
    select extract(epoch from "resolvedAt" - "createdAt") / 3600 hours
    from "Notification" where "actionType" is not null and "resolvedAt" >= ${s} and "resolvedAt" < ${e}`
  const p50 = median(answered.map((x) => Number(x.hours)))
  if (p50 !== null) rows.push({ key: "notifications.responseHours.p50", value: round(p50), detail: { answered: answered.length } })

  // ── 비용: AI 호출. GeminiUsage 에 모델이 남지 않아 원화 환산은 하지 않는다 — 경로별 토큰만 쌓는다
  const ai = await prisma.$queryRaw<{ endpoint: string; calls: number; prompt: number; output: number }[]>`
    select endpoint, count(*)::int calls, sum("promptTokens")::int prompt, sum("candidateTokens")::int output
    from "GeminiUsage" where "createdAt" >= ${s} and "createdAt" < ${e} group by endpoint order by calls desc`
  const sum = (k: "calls" | "prompt" | "output") => ai.reduce((a, x) => a + x[k], 0)
  rows.push(
    { key: "ai.calls", value: sum("calls"), detail: Object.fromEntries(ai.map((x) => [x.endpoint, x.calls])) },
    { key: "ai.tokens.prompt", value: sum("prompt") },
    { key: "ai.tokens.output", value: sum("output"), detail: Object.fromEntries(ai.map((x) => [x.endpoint, x.prompt + x.output])) }
  )

  return rows
}

/** 같은 날·같은 지표는 덮어쓴다. */
export async function saveDailyKpis(day: string, rows: KpiRow[]): Promise<void> {
  const date = new Date(`${day}T00:00:00Z`)
  await prisma.$transaction(
    rows.map((r) =>
      prisma.kpiDaily.upsert({
        where: { day_key: { day: date, key: r.key } },
        create: { day: date, key: r.key, value: r.value, detail: r.detail },
        update: { value: r.value, detail: r.detail },
      })
    )
  )
}

/**
 * Prisma 클라이언트가 KPI 표를 아는지. `generated/prisma` 는 gitignore 라 체크아웃마다 따로 낡는다 —
 * 10/16 이전에 만든 클라이언트는 `kpiDaily` 가 undefined 라 원인 모를 TypeError 로 죽는다(2026-10-21).
 */
export function assertKpiClient(client: object = prisma): void {
  const missing = (["kpiDaily", "taskEvent"] as const).filter((m) => !(client as Record<string, unknown>)[m])
  if (missing.length) {
    throw new Error(`Prisma 클라이언트에 ${missing.join(" · ")} 가 없다 — 스키마보다 낡았다. \`npx prisma generate\` 를 먼저 돌린다`)
  }
}

/** 이력이 쌓이기 시작한 한국 날짜. 이력이 하나도 없으면 null. */
export async function eventsSince(): Promise<string | null> {
  const first = await prisma.taskEvent.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } })
  return first ? kstDay(first.createdAt) : null
}

/**
 * 하루 크론이 부른다. 막 끝난 어제를 상태 포함으로, 그 전날과 오늘(크론이 도는 새벽까지)은 상태 없이 다시 계산한다.
 * 크론이 하루 빠져도 그 전날분이 다음 날 메워진다. 계산하는 순간의 상태(열린 업무 수 등)만은 빠진 날을 되살릴 수 없다.
 */
export async function runDailyKpis(now = new Date()): Promise<{ days: string[]; rows: number }> {
  const day = (back: number) => kstDay(new Date(now.getTime() - back * 86_400_000))
  const since = await eventsSince()
  const plan = [[day(2), false], [day(1), true], [day(0), false]] as const
  let n = 0
  for (const [d, withSnapshot] of plan) {
    const rows = await computeDailyKpis(d, { withEvents: since !== null && d >= since, withSnapshot })
    await saveDailyKpis(d, rows)
    n += rows.length
  }
  return { days: plan.map(([d]) => d), rows: n }
}
