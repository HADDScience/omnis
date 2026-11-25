// 인증 · 국가과제 결정 고치기 — 화면 API 와 AI 도구(lib/tools/plan-grants.ts)가 같은 함수를 부른다.
// 권한: 구성원이면 누구나 고친다(연혁과 같다). 누가 무엇을 바꿨는지는 활동 기록에 남는다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import type { CertStatus, GrantStage, Prisma } from "@/generated/prisma/client"
import {
  CERT_STATUSES,
  CERT_STATUS_LABEL,
  GRANT_STAGES,
  GRANT_STAGE_LABEL,
  parseYmd,
  seoulYmd,
} from "@/lib/grants-labels"

export type OpResult<T = unknown> =
  | { ok: true; changed: string[]; value: T }
  | { ok: false; status: number; error: string }

const fail = (status: number, error: string) =>
  ({ ok: false, status, error }) as const

// ─── 인증 ───

export interface CertPatch {
  status?: unknown
  note?: unknown
  acquiredOn?: unknown
  validUntil?: unknown
}

/** 인증 상태 · 메모 · 취득일 · 유효기간 고치기. 준 칸만 바꾼다 */
export async function updateCertification(
  userId: string,
  id: string,
  patch: CertPatch
): Promise<OpResult<{ id: string; name: string }>> {
  const before = await prisma.companyCertification.findUnique({ where: { id } })
  if (!before) return fail(404, "없는 인증입니다")
  const data: Prisma.CompanyCertificationUpdateInput = {}
  const changed: string[] = []

  if (patch.status !== undefined) {
    if (!CERT_STATUSES.includes(patch.status as CertStatus))
      return fail(400, "상태가 올바르지 않습니다")
    if (patch.status !== before.status) {
      data.status = patch.status as CertStatus
      changed.push(
        `상태 ${CERT_STATUS_LABEL[before.status]} → ${CERT_STATUS_LABEL[patch.status as CertStatus]}`
      )
    }
  }
  if (patch.note !== undefined) {
    const note =
      typeof patch.note === "string"
        ? patch.note.trim().slice(0, 2000) || null
        : null
    if (note !== before.note) {
      data.note = note
      changed.push("메모")
    }
  }
  for (const [key, label] of [
    ["acquiredOn", "취득일"],
    ["validUntil", "유효기간"],
  ] as const) {
    if (patch[key] === undefined) continue
    const d = parseYmd(patch[key])
    if (d === undefined) return fail(400, `${label}은 YYYY-MM-DD 로 적습니다`)
    if (seoulYmd(d) !== seoulYmd(before[key])) {
      data[key] = d
      changed.push(
        `${label} ${seoulYmd(before[key]) ?? "없음"} → ${seoulYmd(d) ?? "지움"}`
      )
    }
  }
  if (changed.length === 0) return fail(400, "바뀌는 칸이 없습니다")

  const row = await prisma.companyCertification.update({ where: { id }, data })
  await writeActivity({
    userId,
    action: "company.certification.updated",
    entity: "COMPANY_CERTIFICATION",
    entityId: id,
    title: `인증 수정: ${row.name}`,
    metadata: { changed },
  })
  return { ok: true, changed, value: { id, name: row.name } }
}

// ─── 국가과제 결정 ───

export interface DecisionPatch {
  stage?: unknown
  stageReason?: unknown
  note?: unknown
  deadline?: unknown
  /** 담당자 id 목록 — 주면 통째로 바꾼다 */
  ownerIds?: unknown
  taskId?: unknown
  projectId?: unknown
}

/** 과제 결정 고치기 — 단계 · 사유 · 메모 · 마감 · 담당자 · 신청 업무 · 선정 과제 프로젝트 */
export async function updateGrantDecision(
  userId: string,
  id: string,
  patch: DecisionPatch
): Promise<OpResult<{ id: string; title: string }>> {
  const before = await prisma.grantDecision.findUnique({
    where: { id },
    include: {
      owners: { include: { user: { select: { id: true, name: true } } } },
      task: { select: { name: true } },
      project: { select: { name: true } },
    },
  })
  if (!before) return fail(404, "없는 과제 결정입니다")
  const data: Prisma.GrantDecisionUncheckedUpdateInput = {}
  const changed: string[] = []

  if (patch.stage !== undefined) {
    if (!GRANT_STAGES.includes(patch.stage as GrantStage))
      return fail(400, "단계가 올바르지 않습니다")
    if (patch.stage !== before.stage) {
      data.stage = patch.stage as GrantStage
      changed.push(
        `단계 ${GRANT_STAGE_LABEL[before.stage]} → ${GRANT_STAGE_LABEL[patch.stage as GrantStage]}`
      )
    }
  }
  for (const [key, label] of [
    ["stageReason", "사유"],
    ["note", "메모"],
  ] as const) {
    if (patch[key] === undefined) continue
    const v =
      typeof patch[key] === "string"
        ? (patch[key] as string).trim().slice(0, 2000) || null
        : null
    if (v !== before[key]) {
      data[key] = v
      changed.push(label)
    }
  }
  if (patch.deadline !== undefined) {
    const d = parseYmd(patch.deadline)
    if (d === undefined) return fail(400, "마감은 YYYY-MM-DD 로 적습니다")
    if (seoulYmd(d) !== seoulYmd(before.deadline)) {
      data.deadline = d
      changed.push(
        `마감 ${seoulYmd(before.deadline) ?? "없음"} → ${seoulYmd(d) ?? "지움"}`
      )
    }
  }
  if (patch.taskId !== undefined) {
    const taskId =
      typeof patch.taskId === "string" && patch.taskId ? patch.taskId : null
    if (
      taskId &&
      !(await prisma.task.findUnique({
        where: { id: taskId },
        select: { id: true },
      }))
    )
      return fail(400, "없는 업무입니다")
    if (taskId !== before.taskId) {
      data.taskId = taskId
      changed.push(taskId ? "신청 업무 연결" : "신청 업무 연결 해제")
    }
  }
  if (patch.projectId !== undefined) {
    const projectId =
      typeof patch.projectId === "string" && patch.projectId
        ? patch.projectId
        : null
    if (
      projectId &&
      !(await prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      }))
    )
      return fail(400, "없는 프로젝트입니다")
    if (projectId !== before.projectId) {
      data.projectId = projectId
      changed.push(projectId ? "과제 프로젝트 연결" : "과제 프로젝트 연결 해제")
    }
  }

  let ownerIds: string[] | null = null
  if (patch.ownerIds !== undefined) {
    if (
      !Array.isArray(patch.ownerIds) ||
      patch.ownerIds.some((x) => typeof x !== "string")
    )
      return fail(400, "담당자 목록이 올바르지 않습니다")
    const ids = [...new Set(patch.ownerIds as string[])]
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true },
    })
    if (users.length !== ids.length)
      return fail(400, "재직 구성원만 담당자로 넣습니다")
    const beforeIds = before.owners.map((o) => o.userId).sort()
    if (JSON.stringify(beforeIds) !== JSON.stringify([...ids].sort())) {
      ownerIds = ids
      const name = new Map(users.map((u) => [u.id, u.name]))
      changed.push(
        `담당 ${before.owners.map((o) => o.user.name).join("·") || "없음"} → ${ids.map((i) => name.get(i)).join("·") || "없음"}`
      )
    }
  }
  if (changed.length === 0) return fail(400, "바뀌는 칸이 없습니다")

  const row = await prisma.$transaction(async (tx) => {
    if (ownerIds) {
      // 바뀌지 않은 사람의 역할(role)은 남긴다
      await tx.grantDecisionOwner.deleteMany({
        where: { decisionId: id, userId: { notIn: ownerIds } },
      })
      await tx.grantDecisionOwner.createMany({
        data: ownerIds.map((userId) => ({ decisionId: id, userId })),
        skipDuplicates: true,
      })
    }
    return tx.grantDecision.update({ where: { id }, data })
  })
  await writeActivity({
    userId,
    action: "grant.decision.updated",
    entity: "GRANT_DECISION",
    entityId: id,
    title: `국가과제 결정 수정: ${row.title}`,
    metadata: { changed },
  })
  return { ok: true, changed, value: { id, title: row.title } }
}

/** 과제 후보를 「우리 결정」 에 올린다 — 검토 단계로. 같은 공고는 한 번만 */
export async function createDecisionFromNotice(
  userId: string,
  noticeId: string
): Promise<OpResult<{ id: string; title: string }>> {
  const notice = await prisma.grantNotice.findUnique({
    where: { id: noticeId },
  })
  if (!notice) return fail(404, "없는 공고입니다")
  const already = await findDecisionForNotice(notice.externalKey)
  if (already)
    return fail(409, `이미 「우리 결정」 에 있습니다 — ${already.title}`)
  const row = await prisma.grantDecision.create({
    data: {
      externalKey: notice.externalKey,
      title: notice.title,
      stage: "REVIEW",
      deadline: notice.deadlineAt,
      noticeLinks: [
        {
          relation: "same",
          export_key: notice.externalKey,
          notice: notice.externalKey,
          title: notice.title,
          date: seoulYmd(notice.deadlineAt),
        },
      ],
      owners: { create: [{ userId }] },
    },
  })
  await writeActivity({
    userId,
    action: "grant.decision.created",
    entity: "GRANT_DECISION",
    entityId: row.id,
    title: `국가과제 결정 추가: ${row.title}`,
    metadata: { notice: notice.externalKey },
  })
  return {
    ok: true,
    changed: ["검토 단계로 추가", "담당: 올린 사람"],
    value: { id: row.id, title: row.title },
  }
}

/** 이 공고를 가리키는 결정 — 같은 key 로 만들었거나 노션 결정의 공고 연결(export_key)에 있으면 */
export async function findDecisionForNotice(externalKey: string) {
  return prisma.grantDecision.findFirst({
    where: {
      OR: [
        { externalKey },
        { noticeLinks: { array_contains: [{ export_key: externalKey }] } },
      ],
    },
    select: { id: true, title: true, stage: true },
  })
}

/** 공고 key 묶음 중 이미 결정이 있는 것 — 후보 목록의 「올림」 표시용 */
export async function decidedNoticeKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const rows = await prisma.grantDecision.findMany({
    select: { externalKey: true, noticeLinks: true },
  })
  const out = new Set<string>()
  const want = new Set(keys)
  for (const r of rows) {
    if (want.has(r.externalKey)) out.add(r.externalKey)
    for (const l of (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
      export_key?: string
      notice?: string
    }[]) {
      if (l.export_key && want.has(l.export_key)) out.add(l.export_key)
      if (l.notice && want.has(l.notice)) out.add(l.notice)
    }
  }
  return out
}
