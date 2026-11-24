// 채용 지원서 접수 — 홈페이지가 여는 지원서 · 브라우저가 보내는 조각 · 홈페이지가 확정하는 접수.
// 라우트: app/api/website/applications/** · 계약: ~/work/omnis-reports/omnis-hr-api-contract-261124.md
//
// 결과를 { status, body } 로 돌려준다 — 라우트는 그대로 응답만 만든다. 로그에는 지원자 칸을 싣지 않는다(id · code · 상태만).
import { prisma } from "@/lib/db"
import { claimOnce } from "@/lib/app-settings"
import { createNotification } from "@/lib/notifications"
import { runAfterResponse } from "@/lib/after-response"
import { dispatchApplicationMails } from "./mail-server"
import { activeReviewerIds } from "./reviewers"
import { applicationFileSize, putApplicationPart } from "./storage"
import {
  DUPLICATE_WINDOW_MS,
  PART_BYTES,
  RATE_LIMITS,
  RECEIVING_TTL_MS,
  RETENTION_MONTHS_FALLBACK,
  SLOT_DB,
  TICKET_TTL_MS,
  addMonths,
  applicationFileKey,
  applicationIntakeSchema,
  kstDay,
  looksLikePdf,
  nextApplicationCode,
  partCount,
  partProblem,
  partRange,
  signTicket,
  slotMaxBytes,
  slotParam,
  verifyTicket,
  type SlotParam,
} from "./rules"

export interface Outcome {
  status: number
  body: Record<string, unknown>
}

const unavailable: Outcome = { status: 503, body: { error: "unavailable" } }

export interface UploadSlip {
  slot: SlotParam
  url: string
  ticket: string
  size: number
  partBytes: number
  parts: number
  expiresAt: string
}

function uploadKey(): string | null {
  return process.env.WEBSITE_CAREER_UPLOAD_KEY || null
}

function slipsFor(app: { id: string; files: { slot: "RESUME" | "PORTFOLIO"; size: number }[] }, origin: string, key: string, now = Date.now()): UploadSlip[] {
  const expiresAt = now + TICKET_TTL_MS
  return app.files.map((f) => {
    const slot = slotParam(f.slot)
    return {
      slot,
      url: `${origin}/api/website/applications/${app.id}/files/${slot}`,
      ticket: signTicket({ applicationId: app.id, slot, size: f.size, expiresAt }, key),
      size: f.size,
      partBytes: PART_BYTES,
      parts: partCount(f.size),
      expiresAt: new Date(expiresAt).toISOString(),
    }
  })
}

// ─── ② 지원서 열기 ───

export async function openApplication(raw: unknown, origin: string, now = new Date()): Promise<Outcome> {
  const key = uploadKey()
  if (!key) return unavailable
  const parsed = applicationIntakeSchema.safeParse(raw)
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid_application", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) } }
  }
  const input = parsed.data
  const email = input.email.toLowerCase()

  const dup = await prisma.jobApplication.findFirst({
    where: { email, jobSlug: input.job, createdAt: { gte: new Date(now.getTime() - DUPLICATE_WINDOW_MS) }, purgedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, code: true, stage: true, files: { select: { slot: true, size: true } } },
  })
  if (dup) {
    if (dup.stage !== "RECEIVING") return { status: 200, body: { ok: true, id: dup.id, duplicate: true, code: dup.code, uploads: [] } }
    return { status: 200, body: { ok: true, id: dup.id, duplicate: true, uploads: slipsFor(dup, origin, key, now.getTime()) } }
  }

  const since = new Date(now.getTime() - 24 * 3600_000)
  const [byEmail, byIp] = await Promise.all([
    prisma.jobApplication.count({ where: { email, createdAt: { gte: since } } }),
    input.ip ? prisma.jobApplication.count({ where: { ip: input.ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ])
  if (byEmail >= RATE_LIMITS.perEmail || byIp >= RATE_LIMITS.perIp) return { status: 429, body: { error: "rate_limited" } }

  const files = [
    { slot: "resume" as const, meta: input.resume },
    ...(input.portfolioFile ? [{ slot: "portfolio" as const, meta: input.portfolioFile }] : []),
  ]
  const created = await prisma.$transaction(async (tx) => {
    const app = await tx.jobApplication.create({
      data: {
        jobSlug: input.job,
        jobTitle: input.jobTitle,
        lang: input.lang,
        name: input.name,
        department: input.department,
        studentId: input.studentId,
        grade: input.grade,
        graduation: input.graduation,
        phone: input.phone,
        email,
        portfolioUrl: input.portfolioUrl || null,
        interests: input.interests,
        motivation: input.motivation,
        consentAt: now,
        consentVersion: input.consentVersion,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
      select: { id: true },
    })
    await tx.jobApplicationFile.createMany({
      data: files.map((f) => ({
        applicationId: app.id,
        slot: SLOT_DB[f.slot],
        objectKey: applicationFileKey(app.id, f.slot),
        fileName: f.meta.name,
        size: f.meta.size,
      })),
    })
    return tx.jobApplication.findUniqueOrThrow({ where: { id: app.id }, select: { id: true, files: { select: { slot: true, size: true } } } })
  })
  console.log("[hr] 지원서 열림", created.id, input.job)
  return { status: 201, body: { ok: true, id: created.id, duplicate: false, uploads: slipsFor(created, origin, key, now.getTime()) } }
}

// ─── ③ 조각 받기 ───

export async function receivePart(input: {
  applicationId: string
  slot: SlotParam
  part: number
  ticket: string
  body: Buffer
  now?: number
}): Promise<Outcome> {
  const key = uploadKey()
  if (!key) return unavailable
  const t = verifyTicket(input.ticket, { applicationId: input.applicationId, slot: input.slot }, key, input.now)
  if (!t.ok) return { status: 401, body: { error: "bad_ticket" } }

  const file = await prisma.jobApplicationFile.findUnique({
    where: { applicationId_slot: { applicationId: input.applicationId, slot: SLOT_DB[input.slot] } },
    select: { id: true, objectKey: true, size: true, receivedBytes: true, application: { select: { stage: true, createdAt: true } } },
  })
  if (!file || Date.now() - file.application.createdAt.getTime() > RECEIVING_TTL_MS) return { status: 404, body: { error: "not_found" } }
  if (file.application.stage !== "RECEIVING") return { status: 409, body: { error: "not_receiving" } }
  if (t.size !== file.size) return { status: 401, body: { error: "bad_ticket" } }
  // 열 때 검사를 지난 크기지만, 칸 상한을 여기서도 본다 — 상한을 바꾸기 전에 열린 지원서 · 손으로 고친 행이 와도 넘지 않게
  if (file.size > slotMaxBytes(input.slot)) return { status: 400, body: { error: "bad_part", detail: "파일이 칸 상한보다 큽니다" } }

  const problem = partProblem({ part: input.part, bodyBytes: input.body.length, size: file.size, receivedBytes: file.receivedBytes })
  if (problem) return { status: 400, body: { error: "bad_part", detail: problem } }
  if (input.part === 0 && !looksLikePdf(input.body)) return { status: 400, body: { error: "not_pdf" } }

  const { start, end } = partRange(input.part, file.size)
  let status: number
  try {
    status = await putApplicationPart(file.objectKey, input.body, start, file.size)
  } catch (e) {
    console.error("[hr] NAS 조각 쓰기 실패", input.applicationId, input.slot, input.part, e instanceof Error ? e.message : e)
    return { status: 503, body: { error: "nas_unavailable" } }
  }
  if (status < 200 || status >= 300) {
    console.error("[hr] NAS 조각 쓰기 거절", input.applicationId, input.slot, input.part, status)
    return { status: 503, body: { error: "nas_unavailable" } }
  }
  // 앞에서부터 이어 받은 바이트 — 다시 보낸 조각이 값을 줄이지 않게 「더 클 때만」
  await prisma.jobApplicationFile.updateMany({ where: { id: file.id, receivedBytes: { lt: end } }, data: { receivedBytes: end } })
  return { status: 204, body: {} }
}

// ─── ⑤ 접수 확정 ───

export async function completeApplication(applicationId: string, now = new Date()): Promise<Outcome> {
  const app = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, code: true, stage: true, jobTitle: true, createdAt: true, files: { select: { id: true, slot: true, objectKey: true, size: true, receivedBytes: true } } },
  })
  if (!app || (app.stage === "RECEIVING" && now.getTime() - app.createdAt.getTime() > RECEIVING_TTL_MS)) {
    return { status: 404, body: { error: "not_found" } }
  }
  if (app.stage !== "RECEIVING") return { status: 200, body: { ok: true, code: app.code, duplicate: true } }

  const missing: SlotParam[] = []
  for (const f of app.files) {
    if (f.receivedBytes !== f.size) {
      missing.push(slotParam(f.slot))
      continue
    }
    let stored: number | null
    try {
      stored = await applicationFileSize(f.objectKey)
    } catch (e) {
      console.error("[hr] NAS 크기 확인 실패", app.id, e instanceof Error ? e.message : e)
      return unavailable
    }
    if (stored !== f.size) missing.push(slotParam(f.slot))
  }
  if (missing.length) return { status: 409, body: { error: "upload_incomplete", missing } }

  const day = kstDay(now)
  let code: string | null = null
  // 같은 날 두 지원서가 동시에 번호를 잡으면 unique 가 하나를 막는다 — 다시 잡는다
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const used = await prisma.jobApplication.findMany({ where: { code: { startsWith: `APP${day}-` } }, select: { code: true } })
    const candidate = nextApplicationCode(day, used.map((u) => u.code))
    try {
      const r = await prisma.jobApplication.updateMany({
        where: { id: app.id, stage: "RECEIVING" },
        data: { code: candidate, stage: "RECEIVED", receivedAt: now, purgeAfter: addMonths(now, RETENTION_MONTHS_FALLBACK) },
      })
      if (r.count === 0) {
        // 다른 요청이 먼저 확정했다(재시도가 겹쳤다)
        const done = await prisma.jobApplication.findUnique({ where: { id: app.id }, select: { code: true } })
        return { status: 200, body: { ok: true, code: done?.code ?? null, duplicate: true } }
      }
      code = candidate
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e
    }
  }
  if (!code) return unavailable

  await prisma.$transaction([
    prisma.jobApplicationFile.updateMany({ where: { applicationId: app.id }, data: { uploadedAt: now } }),
    prisma.jobApplicationEvent.create({ data: { applicationId: app.id, fromStage: "RECEIVING", toStage: "RECEIVED" } }),
  ])
  console.log("[hr] 지원서 접수", app.id, code)

  // 접수 확인 메일(지원자) · 회사 사본(info@) — 응답 뒤에 보낸다. 메일이 늦거나 실패해도 접수(201)는 막지 않는다.
  // 여기는 RECEIVING → RECEIVED 로 바꾼 요청 하나만 온다(위 updateMany). 중복 complete 는 위에서 200 duplicate 로 끝난다
  runAfterResponse("hr-mail", () => dispatchApplicationMails(app.id))

  // 알림이 실패해도 접수는 성공이다 — 지원서함에 RECEIVED 로 남는다(문의함과 같다)
  try {
    await notifyNewApplication({ id: app.id, code, jobTitle: app.jobTitle, receivedAt: now })
  } catch (e) {
    console.error("[hr] 알림 실패", app.id, e instanceof Error ? e.message : e)
  }
  return { status: 201, body: { ok: true, code } }
}

const timeFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })

/**
 * 새 지원서 알림 — 이름 · 연락처를 싣지 않는다. 푸시는 잠금 화면에 뜨고, 벨 기록은 파기 전까지 DB 에 남는다.
 * 담당이 없으면 관리자에게 「담당이 없다」 만(하루 한 번).
 */
export async function notifyNewApplication(a: { id: string; code: string; jobTitle: string; receivedAt: Date }): Promise<{ sent: number; unassigned: boolean }> {
  const reviewers = await activeReviewerIds()
  if (reviewers.length) {
    for (const userId of reviewers) {
      await createNotification(userId, "job_application", `새 지원서 — ${a.jobTitle}`, `${a.code} · 접수 ${timeFmt.format(a.receivedAt)}`, a.id)
    }
    return { sent: reviewers.length, unassigned: false }
  }
  if (!(await claimOnce(`hr_unassigned_alert:${kstDay(a.receivedAt)}`, { at: a.receivedAt.toISOString() }))) return { sent: 0, unassigned: true }
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } })
  for (const u of admins) {
    await createNotification(u.id, "job_application_unassigned", "채용 담당이 없어 지원서가 쌓이고 있습니다", "관리자 › 운영 › 채용 담당에서 볼 사람을 정해 주세요. 정하기 전에는 아무도 지원서를 볼 수 없습니다.", "hr")
  }
  return { sent: admins.length, unassigned: true }
}
