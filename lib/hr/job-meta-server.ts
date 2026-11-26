// 공고별 면접 정보 읽기 · 쓰기 — 화면(PATCH /api/hr/jobs/[slug]) · 도구(update_job_posting · list_applications) · 면접자료 표지가 같이 쓴다.
// 권한(채용 담당)은 부르는 쪽이 먼저 본다(lib/hr/reviewers.ts isHrReviewer).
import { prisma } from "@/lib/db"
import { JOB_META_FIELDS, JobMetaPatchSchema, type JobMetaPatch } from "@/lib/schemas/hr-job"
import { emptyMeta, readSlots, sortSlots, staleMetaFields, type JobMeta } from "./job-meta"

export const JOB_SLUG = /^[a-z0-9-]{3,100}$/

type Row = { jobSlug: string; interviewSlots: unknown; interviewPlace: string | null; interviewMode: string | null; videoUrl: string | null; memo: string | null }
const toMeta = (r: Row): JobMeta => ({
  jobSlug: r.jobSlug,
  slots: readSlots(r.interviewSlots),
  place: r.interviewPlace,
  mode: r.interviewMode === "IN_PERSON" || r.interviewMode === "VIDEO" ? r.interviewMode : null,
  videoUrl: r.videoUrl,
  memo: r.memo,
})

/** 공고 하나 — 줄이 없으면 빈 값 */
export async function loadJobMeta(slug: string): Promise<JobMeta> {
  const r = await prisma.jobPostingMeta.findUnique({ where: { jobSlug: slug } })
  return r ? toMeta(r) : emptyMeta(slug)
}

export async function loadJobMetas(slugs: string[]): Promise<Map<string, JobMeta>> {
  if (slugs.length === 0) return new Map()
  const rows = await prisma.jobPostingMeta.findMany({ where: { jobSlug: { in: slugs } } })
  return new Map(rows.map((r) => [r.jobSlug, toMeta(r)]))
}

export type MetaResult = { ok: true; meta: JobMeta; changed: string[] } | { ok: false; status: number; error: string }

const LABEL: Record<string, string> = { slots: "면접 일시", place: "면접 장소", mode: "면접 방식", videoUrl: "화상 링크", memo: "메모" }

/** 칸 고치기 — 바뀐 칸만 쓰고 활동 기록에 남긴다. expect 가 있고 그새 그 칸이 바뀌었으면 409 */
export async function updateJobMeta(actorId: string, slug: string, body: unknown, expect?: unknown): Promise<MetaResult> {
  if (!JOB_SLUG.test(slug)) return { ok: false, status: 404, error: "없는 공고입니다" }
  const parsed = JobMetaPatchSchema.safeParse(body)
  if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? "값이 올바르지 않습니다" }
  const patch: JobMetaPatch = parsed.data
  if (!JOB_META_FIELDS.some((k) => patch[k] !== undefined)) return { ok: false, status: 400, error: "고칠 칸이 없습니다" }

  return prisma.$transaction(async (tx) => {
    const row = await tx.jobPostingMeta.findUnique({ where: { jobSlug: slug } })
    const now = row ? toMeta(row) : emptyMeta(slug)
    const stale = staleMetaFields(expect, now)
    if (stale.length) return { ok: false as const, status: 409, error: `그새 다른 사람이 ${stale.map((k) => LABEL[k] ?? k).join(" · ")}을(를) 고쳤습니다` }
    const next: JobMeta = {
      ...now,
      ...(patch.slots !== undefined ? { slots: sortSlots(patch.slots) } : {}),
      ...(patch.place !== undefined ? { place: patch.place } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.videoUrl !== undefined ? { videoUrl: patch.videoUrl } : {}),
      ...(patch.memo !== undefined ? { memo: patch.memo } : {}),
    }
    const changed = JOB_META_FIELDS.filter((k) => JSON.stringify(now[k] ?? null) !== JSON.stringify(next[k] ?? null))
    if (changed.length === 0) return { ok: true as const, meta: now, changed: [] }
    const data = {
      interviewSlots: next.slots,
      interviewPlace: next.place,
      interviewMode: next.mode,
      videoUrl: next.videoUrl,
      memo: next.memo,
      updatedById: actorId,
    }
    await tx.jobPostingMeta.upsert({ where: { jobSlug: slug }, create: { jobSlug: slug, ...data }, update: data })
    await tx.activityLog.create({
      data: {
        userId: actorId,
        action: "hr.job.meta",
        entity: "job_posting",
        entityId: slug,
        title: `공고 면접 정보: ${slug} — ${changed.map((k) => LABEL[k]).join(" · ")}`,
        metadata: { changed },
      },
    })
    return { ok: true as const, meta: next, changed }
  })
}

