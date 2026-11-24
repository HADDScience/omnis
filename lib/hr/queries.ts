// 지원서함 읽기 — 화면(app/(main)/hr/applications)과 도구(list_applications)가 같은 함수를 쓴다.
// 권한(채용 담당)은 부르는 쪽이 먼저 본다(lib/hr/reviewers.ts isHrReviewer).
import { prisma } from "@/lib/db"
import type { Stage } from "./rules"

export interface ApplicationRow {
  id: string
  code: string | null
  jobSlug: string
  jobTitle: string
  stage: Stage
  name: string | null
  department: string | null
  grade: string | null
  receivedAt: Date | null
  purgeAfter: Date | null
  purgedAt: Date | null
  fileCount: number
}

/** 접수된 지원서(올리는 중 제외) — 최근 접수 먼저 */
export async function listApplications(opts: { jobSlug?: string; stage?: Stage; take?: number } = {}): Promise<ApplicationRow[]> {
  const rows = await prisma.jobApplication.findMany({
    where: {
      stage: opts.stage ?? { not: "RECEIVING" },
      ...(opts.jobSlug ? { jobSlug: opts.jobSlug } : {}),
    },
    orderBy: [{ receivedAt: "desc" }],
    take: opts.take ?? 200,
    select: {
      id: true, code: true, jobSlug: true, jobTitle: true, stage: true, name: true, department: true, grade: true,
      receivedAt: true, purgeAfter: true, purgedAt: true, _count: { select: { files: true } },
    },
  })
  return rows.map(({ _count, ...r }) => ({ ...r, fileCount: _count.files }))
}

export async function getApplication(id: string) {
  return prisma.jobApplication.findFirst({
    where: { id, stage: { not: "RECEIVING" } },
    include: {
      files: { orderBy: { slot: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
    },
  })
}

/** 공고별 · 단계별 건수 — 도구와 목록 머리말 */
export async function applicationCounts(): Promise<{ jobSlug: string; jobTitle: string; stage: Stage; count: number }[]> {
  const rows = await prisma.jobApplication.groupBy({
    by: ["jobSlug", "jobTitle", "stage"],
    where: { stage: { not: "RECEIVING" } },
    _count: { _all: true },
  })
  return rows.map((r) => ({ jobSlug: r.jobSlug, jobTitle: r.jobTitle, stage: r.stage, count: r._count._all }))
}
