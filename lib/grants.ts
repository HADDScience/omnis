// 인증 · 국가과제 결정 고치기 — 화면 API 와 AI 도구(lib/tools/plan-grants.ts)가 같은 함수를 부른다.
// 권한: 구성원이면 누구나 고친다(연혁과 같다). 누가 무엇을 바꿨는지는 활동 기록에 남는다.
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { normalizeNasPath } from "@/lib/nas"
import type { Prisma } from "@/generated/prisma/client"
import {
  CERT_STAGE_LABEL,
  CERT_START_STAGE,
  asCertStage,
  isCertStage,
  parseSeoulMinute,
  seoulMinute,
  GRANT_STAGE_LABEL,
  parseYmd,
  seoulYmd,
  isGrantStage,
  stageLabel,
  GRANT_STAGE_FIELD_LABEL,
  GRANT_START_STAGE,
  won,
} from "@/lib/grants-labels"
import { staleFields, type ExpectKind } from "@/lib/grants-expect"
import {
  checklistProgress,
  normalizeChecklist,
  normalizeEvidence,
  readChecklist,
  readEvidence,
} from "@/lib/certs"

export type OpResult<T = unknown> =
  | { ok: true; changed: string[]; value: T }
  | { ok: false; status: number; error: string }

const fail = (status: number, error: string) =>
  ({ ok: false, status, error }) as const

/** 화면이 본 값(expect)과 지금 값이 다르면 409 — 그새 다른 사람이 고친 칸 */
function conflict(
  expect: unknown,
  current: Record<string, unknown>,
  kinds: Record<string, ExpectKind>,
  labels: Record<string, string>
) {
  const stale = staleFields(expect, current, kinds)
  if (stale.length === 0) return null
  return fail(
    409,
    `그새 다른 사람이 ${stale.map((k) => labels[k] ?? k).join(" · ")}을(를) 바꿨습니다`
  )
}

const CERT_KINDS: Record<string, ExpectKind> = {
  status: "id",
  stageReason: "text",
  name: "text",
  issuer: "text",
  note: "text",
  acquiredOn: "ymd",
  validUntil: "ymd",
  deadline: "minute",
  ownerId: "id",
  checklist: "json",
  evidence: "json",
}
const CERT_LABELS: Record<string, string> = {
  status: "단계",
  stageReason: "사유",
  name: "인증명",
  issuer: "발급 기관",
  note: "메모",
  acquiredOn: "취득일",
  validUntil: "유효기간",
  deadline: "접수 마감",
  ownerId: "담당",
  checklist: "준비물",
  evidence: "근거",
}

// ─── 인증 (아카이브 › 인증 탭 · 도구 · 2026-11-28 단계) ───

export interface CertPatch {
  /** 단계(CERT_STAGES). 칼럼 이름이 status 라 칸 이름도 status 로 받는다 */
  status?: unknown
  stageReason?: unknown
  name?: unknown
  issuer?: unknown
  note?: unknown
  acquiredOn?: unknown
  validUntil?: unknown
  /** 접수 마감 — 「YYYY-MM-DD HH:mm」(서울) · 날짜만이면 그날 23:59 · 빈 값이면 지운다 */
  deadline?: unknown
  /** 담당 사용자 id — 빈 값이면 담당 없음 */
  ownerId?: unknown
  /** 준비물 목록 통째로 — [{ id?, text, done? }] */
  checklist?: unknown
  /** 근거 목록 통째로 — [{ kind, ref, roomId?, label?, at? }] */
  evidence?: unknown
  /** 화면이 고치기 전에 본 값 — 주면 그새 바뀐 칸이 있는지 보고 409 */
  expect?: unknown
}

const shortText = (v: unknown, cap: number) =>
  typeof v === "string" ? v.trim().slice(0, cap) || null : null

/**
 * 인증 고치기 — 준 칸만 바꾼다. 화면(칸 하나씩 + expect) · 보드(단계 + expect) · 도구가 같이 부른다.
 * 활동 기록의 바뀐 칸은 단계를 「상태 …」 로 적는다 — 이식 스크립트의 사람 손질 보호가 이 말머리로 찾는다(scripts/import-grants.ts)
 */
export async function updateCertification(
  userId: string,
  id: string,
  patch: CertPatch
): Promise<OpResult<{ id: string; name: string }>> {
  const before = await prisma.companyCertification.findUnique({ where: { id } })
  if (!before) return fail(404, "없는 인증입니다")
  const clash = conflict(patch.expect, before, CERT_KINDS, CERT_LABELS)
  if (clash) return clash
  const data: Prisma.CompanyCertificationUncheckedUpdateInput = {}
  const changed: string[] = []
  const stageOf = (s: string) => CERT_STAGE_LABEL[asCertStage(s)]

  if (patch.status !== undefined) {
    if (!isCertStage(patch.status)) return fail(400, "단계가 올바르지 않습니다")
    if (patch.status !== before.status) {
      data.status = patch.status
      changed.push(`상태 ${stageOf(before.status)} → ${CERT_STAGE_LABEL[patch.status]}`)
    }
  }
  for (const [key, label, cap] of [
    ["stageReason", "사유", 500],
    ["issuer", "발급 기관", 200],
    ["note", "메모", 2000],
  ] as const) {
    if (patch[key] === undefined) continue
    const v = shortText(patch[key], cap)
    if (v !== before[key]) {
      data[key] = v
      changed.push(label)
    }
  }
  if (patch.name !== undefined) {
    const v = shortText(patch.name, 200)
    if (!v) return fail(400, "인증명은 비울 수 없습니다")
    if (v !== before.name) {
      data.name = v
      changed.push(`인증명 ${before.name} → ${v}`)
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
      changed.push(`${label} ${seoulYmd(before[key]) ?? "없음"} → ${seoulYmd(d) ?? "지움"}`)
    }
  }
  if (patch.deadline !== undefined) {
    const d = parseSeoulMinute(patch.deadline)
    if (d === undefined) return fail(400, "접수 마감은 YYYY-MM-DD HH:mm 로 적습니다")
    if (seoulMinute(d) !== seoulMinute(before.deadline)) {
      data.deadline = d
      changed.push(`접수 마감 ${seoulMinute(before.deadline) ?? "없음"} → ${seoulMinute(d) ?? "지움"}`)
    }
  }
  if (patch.ownerId !== undefined) {
    const owner = typeof patch.ownerId === "string" && patch.ownerId ? patch.ownerId : null
    if (owner !== before.ownerId) {
      if (owner) {
        const u = await prisma.user.findUnique({ where: { id: owner }, select: { name: true } })
        if (!u) return fail(400, "없는 사람입니다")
        changed.push(`담당 → ${u.name}`)
      } else changed.push("담당 지움")
      data.ownerId = owner
    }
  }
  if (patch.checklist !== undefined) {
    const list = normalizeChecklist(patch.checklist)
    if (typeof list === "string") return fail(400, list)
    if (JSON.stringify(list) !== JSON.stringify(readChecklist(before.checklist))) {
      data.checklist = list as unknown as Prisma.InputJsonValue
      const p = checklistProgress(list)
      changed.push(`준비물 ${p.done}/${p.total}`)
    }
  }
  if (patch.evidence !== undefined) {
    const list = normalizeEvidence(patch.evidence)
    if (typeof list === "string") return fail(400, list)
    if (JSON.stringify(list) !== JSON.stringify(readEvidence(before.evidence))) {
      data.evidence = list as unknown as Prisma.InputJsonValue
      changed.push(`근거 ${list.length}개`)
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

export interface CertCandidateInput {
  name?: unknown
  issuer?: unknown
  note?: unknown
  /** 어디서 올렸나 — 「공고 가점표: ○○ 공고」 */
  source?: unknown
}

/**
 * 인증 후보 올리기 — 인증 탭 · 공고 가점표의 「후보로 올리기」 · 도구(add_certification).
 * 같은 이름(공백 · 대소문자 무시)이 이미 있으면 새로 만들지 않고 그 인증을 돌려준다(중복을 만들지 않는다).
 * 이식 멱등 키는 omnis:<uuid> — 수집기 이식(cert:…)과 겹치지 않는다
 */
export async function addCertificationCandidate(
  userId: string,
  input: CertCandidateInput
): Promise<OpResult<{ id: string; name: string; existed: boolean }>> {
  const name = shortText(input.name, 200)
  if (!name) return fail(400, "인증명을 적습니다")
  const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase()
  const same = (
    await prisma.companyCertification.findMany({ select: { id: true, name: true } })
  ).find((c) => compact(c.name) === compact(name))
  if (same) return { ok: true, changed: [], value: { id: same.id, name: same.name, existed: true } }
  const source = shortText(input.source, 300)
  const row = await prisma.companyCertification.create({
    data: {
      externalKey: `omnis:${crypto.randomUUID()}`,
      name,
      issuer: shortText(input.issuer, 200),
      note: shortText(input.note, 2000) ?? (source ? `올린 곳: ${source}` : null),
      status: CERT_START_STAGE,
    },
  })
  await writeActivity({
    userId,
    action: "company.certification.created",
    entity: "COMPANY_CERTIFICATION",
    entityId: row.id,
    title: `인증 후보: ${row.name}`,
    metadata: { source },
  })
  return { ok: true, changed: ["후보로 올림"], value: { id: row.id, name: row.name, existed: false } }
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
  /** NAS 폴더 경로(/HADD Science/…). 빈 문자열이면 연결을 푼다 — 어느 쪽이든 사람이 정한 것으로 남긴다 */
  nasFolder?: unknown
  /** 지원금액 원문(「최대 2억 원」 같은 글) */
  amount?: unknown
  /** 상태별 칸 — 날짜는 YYYY-MM-DD(빈 값이면 지운다), 확정 지원금은 원 단위 정수(문자열 숫자도 받는다) */
  selectedOn?: unknown
  awardedAmount?: unknown
  agreementOn?: unknown
  startsOn?: unknown
  endsOn?: unknown
  completedOn?: unknown
  /** 화면이 고치기 전에 본 값 — 주면 그새 바뀐 칸이 있는지 보고 409 */
  expect?: unknown
}

const DECISION_KINDS: Record<string, ExpectKind> = {
  stage: "id",
  stageReason: "text",
  note: "text",
  amount: "text",
  deadline: "ymd",
  ownerIds: "ids",
  taskId: "id",
  projectId: "id",
  nasFolder: "text",
  selectedOn: "ymd",
  awardedAmount: "int",
  agreementOn: "ymd",
  startsOn: "ymd",
  endsOn: "ymd",
  completedOn: "ymd",
}
const DECISION_LABELS: Record<string, string> = {
  stage: "단계",
  stageReason: "사유",
  note: "메모",
  amount: "지원금액",
  deadline: "마감",
  ownerIds: "담당",
  taskId: "신청 업무",
  projectId: "과제 프로젝트",
  nasFolder: "NAS 폴더",
  ...GRANT_STAGE_FIELD_LABEL,
}

/** 과제 결정 고치기 — 단계 · 사유 · 메모 · 지원금액 · 상태별 칸(선정 · 협약 · 수행 · 완료) · 마감 · 담당자 · 신청 업무 · 선정 과제 프로젝트 · NAS 폴더. 준 칸만 바꾼다 */
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
  const clash = conflict(
    patch.expect,
    { ...before, ownerIds: before.owners.map((o) => o.userId) },
    DECISION_KINDS,
    DECISION_LABELS
  )
  if (clash) return clash
  const data: Prisma.GrantDecisionUncheckedUpdateInput = {}
  const changed: string[] = []

  if (patch.stage !== undefined) {
    if (!isGrantStage(patch.stage))
      return fail(400, "단계가 올바르지 않습니다")
    if (patch.stage !== before.stage) {
      data.stage = patch.stage
      changed.push(
        `단계 ${stageLabel(before.stage)} → ${GRANT_STAGE_LABEL[patch.stage]}`
      )
    }
  }
  for (const [key, label] of [
    ["stageReason", "사유"],
    ["note", "메모"],
    ["amount", "지원금액"],
  ] as const) {
    if (patch[key] === undefined) continue
    const v =
      typeof patch[key] === "string"
        ? (patch[key] as string).trim().slice(0, key === "amount" ? 200 : 2000) ||
          null
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
  for (const key of [
    "selectedOn",
    "agreementOn",
    "startsOn",
    "endsOn",
    "completedOn",
  ] as const) {
    if (patch[key] === undefined) continue
    const label = GRANT_STAGE_FIELD_LABEL[key]
    const d = parseYmd(patch[key])
    if (d === undefined) return fail(400, `${label}은 YYYY-MM-DD 로 적습니다`)
    if (seoulYmd(d) !== seoulYmd(before[key])) {
      data[key] = d
      changed.push(
        `${label} ${seoulYmd(before[key]) ?? "없음"} → ${seoulYmd(d) ?? "지움"}`
      )
    }
  }
  if (patch.awardedAmount !== undefined) {
    const n = parseWon(patch.awardedAmount)
    if (n === undefined)
      return fail(400, "확정 지원금은 원 단위 숫자로 적습니다(예: 120000000)")
    if (n !== before.awardedAmount) {
      data.awardedAmount = n
      changed.push(
        `확정 지원금 ${won(before.awardedAmount) ?? "없음"} → ${won(n) ?? "지움"}`
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

  if (patch.nasFolder !== undefined) {
    const raw =
      typeof patch.nasFolder === "string" ? patch.nasFolder.trim() : ""
    const folder = raw ? normalizeNasPath(raw) : null
    if (raw && !folder)
      return fail(400, "HADD Science 공유폴더 안의 경로만 잇습니다")
    if (folder !== before.nasFolder || before.nasFolderBy !== "user") {
      data.nasFolder = folder
      data.nasFolderBy = "user"
      if (folder !== before.nasFolder)
        changed.push(
          folder ? `NAS 폴더 ${folder.split("/").pop()}` : "NAS 폴더 연결 해제"
        )
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

/** 원 단위 정수 — 숫자 · 문자열 숫자(쉼표 · 「원」 허용). 빈 값은 null, 틀린 값은 undefined */
export function parseWon(v: unknown): bigint | null | undefined {
  if (v === null || v === "") return null
  if (typeof v === "number")
    return Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : undefined
  if (typeof v !== "string") return undefined
  const t = v.replace(/[,\s원]/g, "")
  if (!/^\d{1,15}$/.test(t)) return undefined
  return BigInt(t)
}

/** 과제 후보를 「우리 결정」 에 올린다 — 준비 단계로(상태 v2 의 시작). 같은 공고는 한 번만 */
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
      stage: GRANT_START_STAGE,
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
    changed: ["준비 단계로 추가", "담당: 올린 사람"],
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

/** 공고 key → 그 공고를 가리키는 결정(같은 key 로 만들었거나 공고 연결 export_key · notice 에 있으면) — 첫 결정 하나 */
export async function decisionsForNotices(
  keys: string[]
): Promise<
  Map<string, { id: string; title: string; nasFolder: string | null }>
> {
  const out = new Map<
    string,
    { id: string; title: string; nasFolder: string | null }
  >()
  if (keys.length === 0) return out
  const want = new Set(keys)
  const rows = await prisma.grantDecision.findMany({
    select: {
      id: true,
      title: true,
      externalKey: true,
      noticeLinks: true,
      nasFolder: true,
    },
  })
  for (const r of rows) {
    const v = { id: r.id, title: r.title, nasFolder: r.nasFolder }
    const hit = (k?: string) => k && want.has(k) && !out.has(k) && out.set(k, v)
    hit(r.externalKey)
    for (const l of (Array.isArray(r.noticeLinks) ? r.noticeLinks : []) as {
      export_key?: string
      notice?: string
    }[]) {
      hit(l.export_key)
      hit(l.notice)
    }
  }
  return out
}

/** 공고 key 묶음 중 이미 결정이 있는 것 — 후보 목록의 「올림」 표시용 */
export async function decidedNoticeKeys(keys: string[]): Promise<Set<string>> {
  return new Set((await decisionsForNotices(keys)).keys())
}

/** 노션에서 옮겨 온 결정 — 원천(노션 · 수집기 내보내기)에 남아 있어 지워도 다음 이식이 되살린다. 지우지 않고 중단으로 돌린다 */
export const isImportedDecision = (d: { externalKey: string }) =>
  d.externalKey.startsWith("notion:")

type RemoveDb = Pick<typeof prisma, "grantDecision" | "$transaction">

/**
 * 과제 후보에서 올린 결정을 내린다 — 담당자 줄도 함께 지우고, 누가 내렸는지 활동 기록에 남긴다.
 * 권한은 고치기와 같다(구성원이면 누구나). 노션에서 옮겨 온 결정은 지우지 않는다(409 — 중단으로 바꾸게 한다).
 * 내리면 그 공고는 과제 후보 목록에서 다시 「올리기」 로 돌아온다(올림 표시는 결정 행에서 계산한다).
 */
export async function removeGrantDecision(
  userId: string | null | undefined,
  id: string,
  db: RemoveDb = prisma
): Promise<OpResult<{ id: string; title: string }>> {
  if (!userId) return fail(401, "인증 필요")
  const before = await db.grantDecision.findUnique({
    where: { id },
    include: { owners: { include: { user: { select: { name: true } } } } },
  })
  if (!before) return fail(404, "없는 과제 결정입니다")
  if (isImportedDecision(before))
    return fail(
      409,
      "노션에서 옮겨 온 과제라 내리지 않습니다 — 단계를 「중단」 으로 바꿔 주세요"
    )
  await db.$transaction(async (tx) => {
    await tx.grantDecisionOwner.deleteMany({ where: { decisionId: id } })
    await tx.grantDecision.delete({ where: { id } })
    await tx.activityLog.create({
      data: {
        userId,
        action: "grant.decision.removed",
        entity: "GRANT_DECISION",
        entityId: id,
        title: `국가과제 결정 내림: ${before.title}`,
        metadata: {
          externalKey: before.externalKey,
          stage: before.stage,
          owners: before.owners.map((o) => o.user.name),
        },
      },
    })
  })
  return {
    ok: true,
    changed: ["우리 결정에서 내림"],
    value: { id, title: before.title },
  }
}
