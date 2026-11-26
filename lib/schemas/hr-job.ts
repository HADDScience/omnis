import { z } from "zod"

// 공고별 면접 정보(JobPostingMeta) — 공고 보드 머리의 제자리 편집 · PATCH /api/hr/jobs/[slug] · update_job_posting 이 같은 규칙을 쓴다.
// 브라우저에서도 불러온다(prisma 없음). 계획: mydocs/plans/2026-11-26-hr-job-interview-meta.md

export const INTERVIEW_MODES = ["IN_PERSON", "VIDEO"] as const
export type InterviewMode = (typeof INTERVIEW_MODES)[number]
export const MODE_LABEL: Record<InterviewMode, string> = { IN_PERSON: "대면", VIDEO: "화상" }

export const SlotSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 로")
    .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d, "없는 날짜입니다"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "시각은 HH:MM(24시간)으로"),
  /** 한 사람에 몇 분씩 — 비우면 따로 정하지 않음 */
  minutesEach: z.number().int().min(1, "한 사람 시간은 1분 이상").max(240, "한 사람 시간은 240분 이하").optional(),
})
export type InterviewSlot = z.infer<typeof SlotSchema>

const emptyToNull = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : v)
const optText = (max: number, label: string) =>
  z.preprocess(emptyToNull, z.string().trim().max(max, `${label}은(는) ${max}자 이내로`).nullable())

/** 칸 하나 이상을 고친다 — 준 칸만 바뀐다. 빈 글 · null 이면 그 칸을 지운다 */
export const JobMetaPatchSchema = z
  .object({
    slots: z.array(SlotSchema).max(20, "면접 일시는 20개까지").optional(),
    place: optText(300, "면접 장소").optional(),
    mode: z.preprocess(emptyToNull, z.enum(INTERVIEW_MODES, { message: "면접 방식은 IN_PERSON(대면) · VIDEO(화상)" }).nullable()).optional(),
    videoUrl: z
      .preprocess(emptyToNull, z.string().trim().max(500, "링크는 500자 이내로").regex(/^https:\/\/\S+$/, "링크는 https:// 로 시작하는 주소로").nullable())
      .optional(),
    memo: optText(1000, "메모").optional(),
  })
  .strict()
export type JobMetaPatch = z.infer<typeof JobMetaPatchSchema>
export const JOB_META_FIELDS = ["slots", "place", "mode", "videoUrl", "memo"] as const
export type JobMetaField = (typeof JOB_META_FIELDS)[number]
