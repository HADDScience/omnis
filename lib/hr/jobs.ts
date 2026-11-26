// 채용 공고 — 이름 · 마감. 정본은 홈페이지(hadd-website) content/ko.ts 의 career.jobs[] (slug · title · closesAt).
// 옴니스에는 공고 표가 없고 지원서마다 slug · 제목 사본만 있다(prisma JobApplication). 그래서 마감은 홈페이지 저장소의 공개 원문을 읽어 온다 —
// 한 시간 캐시, 못 읽으면 아래 사본(KNOWN_JOBS)을 쓰고, 둘 다 모르는 공고는 지원서의 제목 사본만으로 「마감 모름」 으로 둔다.
// prisma 를 들이지 않는다(단위 시험이 DB 없이 돈다).

export interface JobInfo {
  slug: string
  title: string
  /** ISO — 모르면 null */
  closesAt: string | null
}

export const JOBS_SOURCE_URL =
  "https://raw.githubusercontent.com/HADDScience/HADDScience.github.io/main/content/ko.ts"

/** 원문을 못 읽을 때 — 홈페이지 content/ko.ts 사본(2026-11-26) */
export const KNOWN_JOBS: JobInfo[] = [
  {
    slug: "suwon-anchor-practicum-intern-2026-winter",
    title: "[수원대 앵커사업단x현장실습] Intern",
    closesAt: "2026-11-27T17:00:00+09:00",
  },
]

/** content/ko.ts 원문에서 jobs 배열의 slug · title · closesAt 을 뽑는다 — 공고 객체마다 slug 가 먼저 오고, 다음 slug 앞까지가 그 공고다 */
export function parseJobs(source: string): JobInfo[] {
  const at = source.search(/\bjobs\s*:\s*\[/)
  if (at < 0) return []
  const body = arrayBody(source, source.indexOf("[", at))
  const slugs = [...body.matchAll(/\bslug:\s*"([a-z0-9-]{3,100})"/g)]
  return slugs.map((m, i) => {
    const chunk = body.slice(m.index!, slugs[i + 1]?.index ?? body.length)
    const title = /\btitle:\s*"((?:[^"\\]|\\.)*)"/.exec(chunk)?.[1]
    const closes = /\bclosesAt:\s*"([^"]+)"/.exec(chunk)?.[1]
    return {
      slug: m[1],
      title: title ? title.replace(/\\"/g, '"') : m[1],
      closesAt: closes && !Number.isNaN(Date.parse(closes)) ? closes : null,
    }
  })
}

/** start 의 [ 와 짝이 맞는 ] 까지 — 따옴표 안의 괄호는 세지 않는다 */
function arrayBody(src: string, start: number): string {
  let depth = 0
  let quote: string | null = null
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'" || c === "`") quote = c
    else if (c === "[" || c === "{") depth++
    else if (c === "]" || c === "}") {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

/** 홈페이지 공고 목록 — 한 시간 캐시. 못 읽으면 사본 */
export async function loadJobs(fetcher: typeof fetch = fetch): Promise<JobInfo[]> {
  try {
    const res = await fetcher(process.env.HR_JOBS_SOURCE_URL || JOBS_SOURCE_URL, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(4000),
    } as RequestInit)
    if (res.ok) {
      const jobs = parseJobs(await res.text())
      if (jobs.length) return mergeKnown(jobs)
    }
  } catch {
    // 아래 사본으로
  }
  return KNOWN_JOBS
}

/** 원문에서 내려간 옛 공고는 사본에서 채운다 */
const mergeKnown = (jobs: JobInfo[]) => [...jobs, ...KNOWN_JOBS.filter((k) => !jobs.some((j) => j.slug === k.slug))]

export interface JobGroup extends JobInfo {
  open: boolean
}

/** 지원서가 있는 공고 + 홈페이지 공고를 합쳐 열린 것(마감 이른 순) · 마감된 것(최근 마감 순)으로 나눈다. 마감을 모르면 열린 쪽 끝 */
export function groupJobs(
  jobs: JobInfo[],
  fromApplications: { slug: string; title: string }[],
  now = Date.now(),
): { open: JobGroup[]; closed: JobGroup[] } {
  const all = new Map<string, JobInfo>()
  for (const a of fromApplications) all.set(a.slug, { slug: a.slug, title: a.title, closesAt: null })
  for (const j of jobs) all.set(j.slug, { ...j, title: j.title || all.get(j.slug)?.title || j.slug })
  const rows = [...all.values()].map((j) => ({ ...j, open: !j.closesAt || Date.parse(j.closesAt) > now }))
  const t = (j: JobInfo) => (j.closesAt ? Date.parse(j.closesAt) : Number.POSITIVE_INFINITY)
  return {
    open: rows.filter((j) => j.open).sort((a, b) => t(a) - t(b)),
    closed: rows.filter((j) => !j.open).sort((a, b) => t(b) - t(a)),
  }
}

// ─── 보드 열 ───

export const BOARD_COLUMNS = [
  { key: "received", label: "접수", stages: ["RECEIVED", "SCREENING"], dropTo: "RECEIVED" },
  { key: "passed", label: "서류 합격", stages: ["INTERVIEW", "OFFERED"], dropTo: "INTERVIEW" },
  { key: "hired", label: "최종 합격", stages: ["HIRED"], dropTo: "HIRED" },
] as const
export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]["key"] | "out"
/** 불합격 · 철회 — 보드 아래 접힌 묶음 */
export const OUT_STAGES = ["REJECTED", "WITHDRAWN"] as const

export function columnOf(stage: string): BoardColumnKey | null {
  if ((OUT_STAGES as readonly string[]).includes(stage)) return "out"
  return BOARD_COLUMNS.find((c) => (c.stages as readonly string[]).includes(stage))?.key ?? null
}
