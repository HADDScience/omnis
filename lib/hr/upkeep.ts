// 채용 지원서 정리 — cron/daily 가 하루 한 번 부른다(크론은 하나로 둔다: Neon 을 하루 한 번만 깨운다).
//
// 1. 접수되지 않은 지원서(RECEIVING, 24시간 지남) — 올리다 만 것. 파일 · 행을 지운다
// 2. 보관 기한(purgeAfter)이 지난 지원서 — 개인정보 칸 · 파일 · 메모 · 알림을 지우고 purgedAt 을 찍는다.
//    행은 공고 · 단계 · 시각 · 번호만 남긴다(「이 공고에 몇 명이 지원했다」 는 남고 사람은 남지 않는다).
//
// NAS 에서 지우지 못하면 그 지원서는 건너뛰고 다음 날 다시 집는다 — DB 만 지우면 파일이 주인 없이 남는다.
// HR_PURGE_DRY_RUN=1 이면 무엇을 지울지 세기만 한다(첫 배포 확인용).
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { deleteApplicationFiles } from "./storage"
import { hrMailClaimKey } from "./mail-server"
import { PURGED_FIELDS, RECEIVING_TTL_MS } from "./rules"

export interface HrUpkeepResult {
  dryRun: boolean
  abandoned: number
  purged: number
  failed: number
}

const BATCH = 50

/** 한 지원서의 개인정보를 지운다 — 크론과(2단계의) 「지금 파기」 가 같은 함수를 쓴다 */
export async function purgeApplication(id: string, why: string, actorId: string | null = null, now = new Date()): Promise<boolean> {
  const app = await prisma.jobApplication.findUnique({ where: { id }, select: { id: true, code: true, purgedAt: true, files: { select: { objectKey: true } } } })
  if (!app || app.purgedAt) return false
  await deleteApplicationFiles(app.id, app.files.map((f) => f.objectKey))
  await prisma.$transaction([
    prisma.jobApplication.update({ where: { id }, data: { ...PURGED_FIELDS, interests: [], purgedAt: now } }),
    prisma.jobApplicationFile.updateMany({ where: { applicationId: id }, data: { fileName: null, deletedAt: now } }),
    prisma.jobApplicationEvent.updateMany({ where: { applicationId: id }, data: { note: null } }),
    prisma.jobApplicationEvent.create({ data: { applicationId: id, actorId, note: why } }),
    prisma.notification.deleteMany({ where: { entityId: id, type: "job_application" } }),
    prisma.appSetting.deleteMany({ where: { key: hrMailClaimKey(id) } }),
  ])
  await writeActivity({ userId: actorId, action: "purged", entity: "job_application", entityId: id, title: `지원서 파기 ${app.code ?? ""}`.trim(), metadata: { why } })
  return true
}

export async function runHrUpkeep(now = new Date(), dryRun = process.env.HR_PURGE_DRY_RUN === "1"): Promise<HrUpkeepResult> {
  const out: HrUpkeepResult = { dryRun, abandoned: 0, purged: 0, failed: 0 }

  const abandoned = await prisma.jobApplication.findMany({
    where: { stage: "RECEIVING", createdAt: { lt: new Date(now.getTime() - RECEIVING_TTL_MS) } },
    select: { id: true, files: { select: { objectKey: true } } },
    take: BATCH,
  })
  const due = await prisma.jobApplication.findMany({
    where: { stage: { not: "RECEIVING" }, purgedAt: null, purgeAfter: { lte: now } },
    select: { id: true },
    take: BATCH,
  })
  if (dryRun) return { ...out, abandoned: abandoned.length, purged: due.length }

  for (const a of abandoned) {
    try {
      await deleteApplicationFiles(a.id, a.files.map((f) => f.objectKey))
      await prisma.jobApplication.delete({ where: { id: a.id } })
      out.abandoned++
    } catch (e) {
      console.error("[hr] 접수 안 된 지원서 정리 실패", a.id, e instanceof Error ? e.message : e)
      out.failed++
    }
  }
  for (const a of due) {
    try {
      if (await purgeApplication(a.id, "보관 기간이 지나 파기", null, now)) out.purged++
    } catch (e) {
      console.error("[hr] 지원서 파기 실패", a.id, e instanceof Error ? e.message : e)
      out.failed++
    }
  }
  return out
}
