// 면접자료 PDF 를 만들 재료를 읽는다 — 지원서(DB) · 원본(NAS, 지원서 파일 내려받기와 같은 길 lib/hr/storage.ts) · 글꼴(assets/fonts).
// 만든 PDF 는 저장하지 않는다. 응답은 조각으로 흘려보낸다(Vercel 함수 응답 4.5MB 한도는 스트리밍 응답에 걸리지 않는다).
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { getApplicationFile } from "./storage"
import { loadJobs } from "./jobs"
import { SLOT_LABEL } from "./rules"
import { BUNDLE_STAGES, canPack, type PackFonts, type PackInput } from "./interview-pack"

let fontCache: Promise<PackFonts> | null = null
export function packFonts(): Promise<PackFonts> {
  fontCache ??= (async () => {
    const dir = join(process.cwd(), "assets/fonts")
    const [regular, bold, extraBold] = await Promise.all(
      ["NanumSquare_acR.ttf", "NanumSquare_acB.ttf", "NanumSquare_acEB.ttf"].map((n) => readFile(join(dir, n))),
    )
    return { regular, bold, extraBold }
  })().catch((e) => {
    fontCache = null
    throw e
  })
  return fontCache
}

const SELECT = {
  id: true, code: true, jobSlug: true, jobTitle: true, stage: true, name: true, department: true, studentId: true, grade: true,
  graduation: true, phone: true, email: true, portfolioUrl: true, interests: true, motivation: true, receivedAt: true, purgedAt: true,
  files: { select: { slot: true, objectKey: true, fileName: true, size: true, receivedBytes: true, deletedAt: true } },
} as const

type Row = NonNullable<Awaited<ReturnType<typeof findOne>>>
const findOne = (id: string) => prisma.jobApplication.findUnique({ where: { id }, select: SELECT })

async function readAll(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = []
  for await (const c of stream) chunks.push(typeof c === "string" ? Buffer.from(c) : (c as Buffer))
  return Buffer.concat(chunks)
}

/** 지원서 한 장 → 묶음 재료. 원본은 이력서 → 포트폴리오 순서, 못 읽은 것은 이유를 단다 */
async function toInput(a: Row): Promise<PackInput> {
  const files = [...a.files].filter((f) => !f.deletedAt).sort((x, y) => (x.slot === "RESUME" ? 0 : 1) - (y.slot === "RESUME" ? 0 : 1))
  const out: PackInput["files"] = []
  for (const f of files) {
    const base = { label: SLOT_LABEL[f.slot], fileName: f.fileName, size: f.size }
    if (f.receivedBytes !== f.size) {
      out.push({ ...base, bytes: null, reason: "업로드가 끝나지 않은 파일" })
      continue
    }
    try {
      const res = await getApplicationFile(f.objectKey)
      out.push({ ...base, bytes: await readAll(res.body) })
    } catch (e) {
      console.error("[hr-pack] NAS 읽기 실패", a.id, f.slot, e instanceof Error ? e.message : e)
      out.push({ ...base, bytes: null, reason: "저장소(NAS)에서 파일을 읽지 못함" })
    }
  }
  return {
    applicant: {
      id: a.id, code: a.code ?? a.id, name: a.name ?? "", department: a.department, studentId: a.studentId, grade: a.grade,
      graduation: a.graduation, phone: a.phone, email: a.email, portfolioUrl: a.portfolioUrl, interests: a.interests,
      motivation: a.motivation, receivedAt: a.receivedAt ?? new Date(0),
    },
    files: out,
  }
}

async function jobTitleOf(slug: string, fallback: string) {
  return (await loadJobs()).find((j) => j.slug === slug)?.title ?? fallback
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

/** 지원자 한 명 — 없는(올리는 중 · 파기) 지원서는 404, 서류 합격 전 · 불합격 · 철회는 403 */
export async function loadApplicantPack(id: string): Promise<Loaded<{ input: PackInput; jobTitle: string }>> {
  const a = await findOne(id)
  if (!a || a.stage === "RECEIVING" || a.purgedAt || !a.code) return { ok: false, status: 404, error: "없는 지원서입니다" }
  if (!canPack(a.stage)) return { ok: false, status: 403, error: "서류 합격한 지원자만 면접자료를 받을 수 있습니다" }
  return { ok: true, value: { input: await toInput(a), jobTitle: await jobTitleOf(a.jobSlug, a.jobTitle) } }
}

/** 공고의 「서류 합격」 열 전체 — 접수 순서 */
export async function loadBundle(slug: string): Promise<Loaded<{ inputs: PackInput[]; jobTitle: string }>> {
  const rows = await prisma.jobApplication.findMany({
    where: { jobSlug: slug, stage: { in: [...BUNDLE_STAGES] }, purgedAt: null, code: { not: null } },
    orderBy: { receivedAt: "asc" },
    select: SELECT,
  })
  if (rows.length === 0) return { ok: false, status: 404, error: "서류 합격한 지원자가 없습니다" }
  const inputs: PackInput[] = []
  for (const r of rows) inputs.push(await toInput(r))
  return { ok: true, value: { inputs, jobTitle: await jobTitleOf(slug, rows[0].jobTitle) } }
}

/** 누가 누구의 면접자료를 받았는지 — 지원자마다 한 줄 */
export async function logPackDownload(userId: string, applicants: { id: string; code: string }[], bundle: string | null) {
  for (const a of applicants) {
    await writeActivity({
      userId,
      action: "hr.application.interview_pack",
      entity: "job_application",
      entityId: a.id,
      title: `면접자료 PDF 내려받기: ${a.code}${bundle ? " (서류 합격 묶음)" : ""}`,
      metadata: bundle ? { bundle } : undefined,
    })
  }
}

/** 만든 PDF 를 조각으로 흘려보낸다 */
export function pdfStream(bytes: Uint8Array, chunk = 256 * 1024): ReadableStream<Uint8Array> {
  let at = 0
  return new ReadableStream({
    pull(ctrl) {
      if (at >= bytes.length) return ctrl.close()
      ctrl.enqueue(bytes.subarray(at, at + chunk))
      at += chunk
    },
  })
}
