// 지원서 단계 바꾸기 — 화면(지원서함 보드 · PATCH /api/hr/applications/[id])과 도구(change_application_stage)가 같은 함수를 부른다.
// 권한(채용 담당)은 부르는 쪽이 먼저 본다(lib/hr/reviewers.ts isHrReviewer). 지원자에게 메일을 보내지 않는다 —
// 메일은 접수 확정(lib/hr/intake.ts → mail-server.ts) 한 곳에서만 나간다.
import { prisma } from "@/lib/db"
import { STAGE_LABEL, type Stage } from "./rules"

/** 사람이 고를 수 있는 단계 — RECEIVING(올리는 중)은 접수 창구만 쓴다 */
export const PICKABLE_STAGES = ["RECEIVED", "SCREENING", "INTERVIEW", "OFFERED", "HIRED", "REJECTED", "WITHDRAWN"] as const
export type PickableStage = (typeof PICKABLE_STAGES)[number]
export const isPickableStage = (v: unknown): v is PickableStage => typeof v === "string" && (PICKABLE_STAGES as readonly string[]).includes(v)

export type StageResult =
  | { ok: true; id: string; code: string | null; from: Stage; to: Stage }
  | { ok: false; status: number; error: string }

type StageDb = Pick<typeof prisma, "jobApplication" | "$transaction">

export async function changeApplicationStage(
  actorId: string,
  id: string,
  to: unknown,
  opts: { note?: string; db?: StageDb } = {},
): Promise<StageResult> {
  const db = opts.db ?? prisma
  if (!isPickableStage(to)) return { ok: false, status: 400, error: "단계가 올바르지 않습니다" }
  const app = await db.jobApplication.findUnique({ where: { id }, select: { id: true, code: true, stage: true } })
  if (!app || app.stage === "RECEIVING") return { ok: false, status: 404, error: "없는 지원서입니다" }
  if (app.stage === to) return { ok: false, status: 400, error: `이미 ${STAGE_LABEL[to]} 단계입니다` }
  const from = app.stage as Stage
  const note = opts.note?.trim().slice(0, 200) || null
  const moved = await db.$transaction(async (tx) => {
    // 다른 사람이 먼저 바꿨으면 덮지 않는다
    const r = await tx.jobApplication.updateMany({
      where: { id, stage: from },
      data: { stage: to, ...(to === "HIRED" || to === "REJECTED" || to === "WITHDRAWN" ? { decidedAt: new Date() } : {}) },
    })
    if (r.count !== 1) return false
    await tx.jobApplicationEvent.create({ data: { applicationId: id, actorId, fromStage: from, toStage: to, note } })
    await tx.activityLog.create({
      data: {
        userId: actorId,
        action: "hr.application.stage",
        entity: "job_application",
        entityId: id,
        title: `지원서 단계: ${app.code ?? id} ${STAGE_LABEL[from]} → ${STAGE_LABEL[to]}`,
        metadata: { from, to, ...(note ? { note } : {}) },
      },
    })
    return true
  })
  if (!moved) return { ok: false, status: 409, error: "그새 다른 사람이 단계를 바꿨습니다 — 새로 고쳐 보세요" }
  return { ok: true, id, code: app.code, from, to }
}
