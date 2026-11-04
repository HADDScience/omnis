import { prisma } from "@/lib/db"
import { pickSurveyTarget, retentionCutoff, summarize, type UiDeploymentRow } from "./rules"

/** 관리 화면에 보일 배포 수. 90일치를 다 펴면 읽을 수 없다 */
const SUMMARY_DEPLOYMENTS = 20

/** 빌드 때 정한 값. 운영에서만 켠다 — 데모 · 프리뷰 · 로컬은 next.config.mjs 에서 꺼진다 */
export const uiMetricsServerEnabled = () => process.env.NEXT_PUBLIC_UI_METRICS === "1"

/** 90일 지난 사용 기록을 지운다. cron/daily 가 깨운 김에 부른다 */
export async function purgeUiEvents(now = new Date()): Promise<number> {
  const { count } = await prisma.uiEvent.deleteMany({ where: { at: { lt: retentionCutoff(now) } } })
  return count
}

export async function surveyTargetFor(userId: string, now = new Date()): Promise<string | null> {
  const [deployments, used, answered] = await Promise.all([
    prisma.uiEvent.groupBy({ by: ["commitSha"], _min: { at: true } }),
    prisma.uiEvent.groupBy({ by: ["commitSha"], where: { userId } }),
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
    _min: { at: true },
    orderBy: { _min: { at: "desc" } },
    take: SUMMARY_DEPLOYMENTS,
  })
  const shas = recent.map((r) => r.commitSha)
  const [events, responses] = await Promise.all([
    prisma.uiEvent.findMany({
      where: { commitSha: { in: shas } },
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
