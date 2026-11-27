// 수집기 govgrants → GrantNotice — 하루 cron(/api/cron/daily)의 한 단계. 규칙은 lib/govgrants-sync-rules.ts.
//
// - 읽기: 운영 Neon 의 govgrants 스키마를 **읽기 전용 역할**(GOVGRANTS_READ_URL)로 읽는다. 수집기의 쓰기 역할 · 앱의 소유자 역할로
//   govgrants 를 읽지 않는다. 읽기도 READ ONLY 트랜잭션 안에서만 한다. 그래서 govgrants.runs.imported_at 은 채우지 않고,
//   옮긴 기록은 옴니스 쪽 GovgrantsImport 에 남긴다(runId 마다 한 줄).
// - 쓰기: GrantNotice 만. 20건씩 트랜잭션으로 쓰고, 트랜잭션마다 omnis.actor_kind=source(이식)를 건다(lib/import-actor.ts —
//   풀러에서도 되는 트랜잭션 안 set_config). 공통 층 트리거가 이식을 사람(screen)으로 세지 않게.
// - 수집기는 2주마다 월요일 07:00 KST 에 돈다. cron 은 매일 04:00 KST 라 화요일 아침에 옮긴다. 새 실행이 없으면 읽기 두 번으로 끝난다.
// - 실패하면 GovgrantsImport 에 failed 로 남기고 알림 메일 · GitHub 이슈(lib/alert-mail · lib/github-issue)를 보낸다. 다음 날 다시 한다.
import { PrismaClient } from "@/generated/prisma/client"
import { prisma } from "@/lib/db"
import { noticeRow, type NoticeItem } from "@/lib/grants-import"
import { ACTOR_SETTING, SOURCE_ACTOR } from "@/lib/import-actor"
import { IMPORTABLE_STATUS, NOTICE_FIELDS, plan, sizeMap, type NoticeField, type PlanCounts } from "@/lib/govgrants-sync-rules"

export const GOVGRANTS_READ_ENV = "GOVGRANTS_READ_URL"
const BATCH = 20

interface RunRow { id: string; status: string; started_at: Date | null; item_count: number | null }
interface NoticeRowRaw { key: string; item: NoticeItem; attachment_sizes: unknown }

/** 읽기 전용 연결로 govgrants 를 읽는다. 트랜잭션도 READ ONLY 로 연다 */
async function readGovgrants<T>(url: string, fn: (q: <R>(sql: TemplateStringsArray, ...v: unknown[]) => Promise<R>) => Promise<T>): Promise<T> {
  const reader = new PrismaClient({ datasourceUrl: url })
  try {
    return await reader.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
      return fn(<R,>(sql: TemplateStringsArray, ...v: unknown[]) => tx.$queryRaw<R>(sql, ...v))
    }, { timeout: 60_000, maxWait: 15_000 })
  } finally {
    await reader.$disconnect()
  }
}

export interface RunResult extends PlanCounts { runId: string; ok: boolean; error?: string }
export interface GovgrantsImportResult {
  configured: boolean
  pending: number
  runs: RunResult[]
}

/**
 * 아직 옮기지 않은 실행을 옮긴다. dry 면 계획만 세고 아무것도 쓰지 않는다(GovgrantsImport 도).
 * readUrl 을 주지 않으면 GOVGRANTS_READ_URL. 없으면 configured false 로 끝난다(알림 없음).
 */
export async function importGovgrants(opts: { dry?: boolean; readUrl?: string } = {}): Promise<GovgrantsImportResult> {
  const url = opts.readUrl ?? process.env[GOVGRANTS_READ_ENV]
  if (!url) return { configured: false, pending: 0, runs: [] }

  const done = new Set(
    (await prisma.govgrantsImport.findMany({ where: { status: "ok" }, select: { runId: true } }).catch((e: { code?: string }) => {
      // 건식은 마이그레이션 전 DB(표 없음, P2021)에서도 돈다 — 옮긴 실행이 없는 것으로 본다
      if (opts.dry && e?.code === "P2021") return []
      throw e
    })).map((r) => r.runId),
  )
  let runs: RunRow[]
  try {
    runs = await readGovgrants(url, (q) =>
      q<RunRow[]>`SELECT id, status, started_at, item_count FROM govgrants.runs WHERE status = ANY(${[...IMPORTABLE_STATUS]}) ORDER BY started_at`)
  } catch (e) {
    // 읽기 연결 · 권한이 깨졌다 — 실행 목록조차 못 읽으면 알린다
    if (!opts.dry) await alertFailure("(실행 목록)", (e as Error).message.slice(0, 500))
    throw e
  }
  const pending = runs.filter((r) => !done.has(r.id))
  const out: GovgrantsImportResult = { configured: true, pending: pending.length, runs: [] }

  for (const run of pending) {
    const startedAt = new Date()
    try {
      const notices = await readGovgrants(url, (q) =>
        q<NoticeRowRaw[]>`SELECT key, item, attachment_sizes FROM govgrants.notices WHERE last_run = ${run.id} AND removed_run IS NULL ORDER BY key`)
      const rows = notices.map((n) => noticeRow({ ...n.item, key: n.item.key ?? n.key }, sizeMap(n.attachment_sizes)))
      const select = Object.fromEntries([["externalKey", true], ...NOTICE_FIELDS.map((f) => [f, true])]) as Record<string, true>
      const existing = new Map<string, Partial<Record<NoticeField, unknown>>>()
      for (let i = 0; i < rows.length; i += 500) {
        const found = await prisma.grantNotice.findMany({ where: { externalKey: { in: rows.slice(i, i + 500).map((r) => r.externalKey) } }, select })
        for (const f of found as unknown as ({ externalKey: string } & Record<NoticeField, unknown>)[]) existing.set(f.externalKey, f)
      }
      const p = plan(rows, existing)
      if (!opts.dry) {
        for (let i = 0; i < p.creates.length; i += BATCH) {
          await asSource((tx) => Promise.all(p.creates.slice(i, i + BATCH).map((r) =>
            // 동시에 사람이 같은 열쇠를 만들 일은 없지만, 다시 돌려도 늘지 않게 upsert
            tx.grantNotice.upsert({ where: { externalKey: r.externalKey }, create: r, update: {} }))))
        }
        for (let i = 0; i < p.updates.length; i += BATCH) {
          await asSource((tx) => Promise.all(p.updates.slice(i, i + BATCH).map((u) =>
            tx.grantNotice.update({ where: { externalKey: u.key }, data: u.data }))))
        }
        await prisma.govgrantsImport.upsert({
          where: { runId: run.id },
          create: { runId: run.id, runStartedAt: run.started_at, status: "ok", itemCount: p.counts.items, newCount: p.counts.new, updatedCount: p.counts.updated, unchangedCount: p.counts.unchanged, fieldCounts: p.counts.fieldCounts, startedAt, finishedAt: new Date() },
          update: { status: "ok", error: null, itemCount: p.counts.items, newCount: p.counts.new, updatedCount: p.counts.updated, unchangedCount: p.counts.unchanged, fieldCounts: p.counts.fieldCounts, startedAt, finishedAt: new Date() },
        })
      }
      out.runs.push({ runId: run.id, ok: true, ...p.counts })
    } catch (e) {
      const error = (e as Error).message.slice(0, 500)
      out.runs.push({ runId: run.id, ok: false, error, items: 0, new: 0, updated: 0, unchanged: 0, fieldCounts: {} })
      if (!opts.dry) {
        await prisma.govgrantsImport.upsert({
          where: { runId: run.id },
          create: { runId: run.id, runStartedAt: run.started_at, status: "failed", error, startedAt, finishedAt: new Date() },
          update: { status: "failed", error, startedAt, finishedAt: new Date() },
        }).catch(() => {})
        await alertFailure(run.id, error)
      }
      // 앞 실행이 실패하면 뒤 실행을 먼저 옮기지 않는다 — 순서가 섞이면 옛 값이 새 값을 덮는다
      break
    }
  }
  return out
}

/** 트랜잭션 안에서 「쓴 쪽 = source」 를 걸고 쓴다(SET LOCAL 과 같다 — 풀러에서도 된다) */
async function asSource<T>(fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('${ACTOR_SETTING}', '${SOURCE_ACTOR}', true)`)
    return fn(tx)
  }, { timeout: 60_000, maxWait: 15_000 })
}

/** 실패 알림 — 다른 배관(Gemini 모델 실패 등)과 같은 길: 운영 알림 메일 + 열린 이슈 하나에 댓글 */
async function alertFailure(runId: string, error: string): Promise<void> {
  const [{ sendAlertMail }, { fileIssue, issueFingerprint, redactForPublic }] = await Promise.all([import("@/lib/alert-mail"), import("@/lib/github-issue")])
  const line = `수집기 실행 ${runId} 을(를) GrantNotice 로 옮기지 못했습니다 — 다음 날 cron 이 다시 합니다`
  await Promise.allSettled([
    sendAlertMail("[Omnis] 국가과제 공고 옮기기 실패", `${line}\n\n${error}`),
    fileIssue({
      fingerprint: issueFingerprint("govgrants-import"),
      title: "[Omnis] 국가과제 공고 옮기기 실패(govgrants → GrantNotice)",
      body: [line, "", "```", redactForPublic(error), "```", "", "lib/govgrants-sync.ts · GovgrantsImport 표에 실패가 남는다."].join("\n"),
      comment: `다시 실패: ${line}`,
    }),
  ])
}
