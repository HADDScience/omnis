import { prisma } from "@/lib/db"
import { SERVER_EVENT_NAMES, type ServerEventName } from "./pilot"
import { DEV_SHA, pickSurveyTarget, retentionCutoff, summarize, type UiDeploymentRow } from "./rules"

/** 관리 화면에 보일 배포 수. 90일치를 다 펴면 읽을 수 없다 */
const SUMMARY_DEPLOYMENTS = 20

/** 빌드 때 정한 값. 운영에서만 켠다 — 데모 · 프리뷰 · 로컬은 next.config.mjs 에서 꺼진다 */
export const uiMetricsServerEnabled = () => process.env.NEXT_PUBLIC_UI_METRICS === "1"

/** 시범 운영 칸만 보는 기록 — 배포별 표 · 설문 대상에는 넣지 않는다(화면을 쓴 기록이 아니다) */
const UI_ONLY = { notIn: [...SERVER_EVENT_NAMES, "push_recv_s", "push_open_s"] }

/** 서버 쪽 기록이 붙는 배포 — 화면이 아니라 이 서버를 만든 빌드 */
const SERVER_SHA = process.env.VERCEL_GIT_COMMIT_SHA || DEV_SHA

/**
 * 서버가 직접 남기는 사용 기록(푸시 발송 · 검색). 이름 · 숫자만 받는다 — 내용을 넘길 인자가 없다.
 * 실패는 삼킨다. 기록 때문에 검색이나 발송이 막히면 안 된다.
 */
export async function recordServerUiEvents(rows: { userId: string; name: ServerEventName; value?: number }[], path: string): Promise<void> {
  if (!uiMetricsServerEnabled() || rows.length === 0) return
  await prisma.uiEvent
    .createMany({ data: rows.map((r) => ({ userId: r.userId, name: r.name, value: r.value ?? null, path, commitSha: SERVER_SHA })) })
    .catch((err) => console.error("[ui-metrics] 서버 기록 실패", err))
}

/** 90일 지난 사용 기록을 지운다. cron/daily 가 깨운 김에 부른다 */
export async function purgeUiEvents(now = new Date()): Promise<number> {
  const { count } = await prisma.uiEvent.deleteMany({ where: { at: { lt: retentionCutoff(now) } } })
  return count
}

export async function surveyTargetFor(userId: string, now = new Date()): Promise<string | null> {
  const [deployments, used, answered] = await Promise.all([
    prisma.uiEvent.groupBy({ by: ["commitSha"], where: { name: UI_ONLY }, _min: { at: true } }),
    prisma.uiEvent.groupBy({ by: ["commitSha"], where: { userId, name: UI_ONLY } }),
    prisma.uiSurveyResponse.findMany({ where: { userId }, select: { commitSha: true } }),
  ])
  return pickSurveyTarget({
    deployments: deployments.flatMap((d) => (d._min.at ? [{ sha: d.commitSha, firstSeenAt: d._min.at }] : [])),
    usedShas: new Set(used.map((u) => u.commitSha)),
    answeredShas: new Set(answered.map((a) => a.commitSha)),
    now,
  })
}

export async function loadUiMetricsSummary(): Promise<UiDeploymentRow[]> {
  const recent = await prisma.uiEvent.groupBy({
    by: ["commitSha"],
    where: { name: UI_ONLY },
    _min: { at: true },
    orderBy: { _min: { at: "desc" } },
    take: SUMMARY_DEPLOYMENTS,
  })
  const shas = recent.map((r) => r.commitSha)
  const [events, responses] = await Promise.all([
    prisma.uiEvent.findMany({
      where: { commitSha: { in: shas }, name: UI_ONLY },
      select: { commitSha: true, userId: true, name: true, value: true, at: true },
    }),
    prisma.uiSurveyResponse.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { commitSha: true, userId: true, score: true, comment: true, createdAt: true },
    }),
  ])
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set([...events, ...responses].map((e) => e.userId))] } },
    select: { id: true, name: true },
  })
  return summarize({ events, responses, names: new Map(users.map((u) => [u.id, u.name])) }).slice(0, SUMMARY_DEPLOYMENTS)
}
