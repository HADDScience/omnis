/**
 * 수집기 내보내기(export/v1) → 옴니스 인증 · 과제 결정 행. DB 를 건드리지 않는 변환만 둔다 —
 * scripts/import-grants.ts 가 이것으로 건식 대조와 실제 쓰기를 한다.
 */
import type { Prisma } from "@/generated/prisma/client"
import type { CertStage } from "@/lib/grants-labels"
import type { GrantStage } from "@/lib/grants-labels"

export type CertItem = {
  key: string
  name: string
  held?: boolean | null
  issuer?: string | null
  bonus_medibio?: string | null
  bonus_mss?: string | null
  difficulty?: string | null
  cost?: string | null
  priority?: string | null
  requirement?: string | null
  note?: string | null
  research?: Record<string, unknown> & {
    official_name?: string
    our_status?: string
    bonus_examples?: unknown
  }
}

export type DecisionItem = {
  key: string
  title: string
  stage: string
  stage_reason?: string | null
  status_raw?: string | null
  owners?: { name: string; raw?: string; role?: string | null }[]
  submitted_title?: string | null
  note?: string | null
  notice_links?: unknown[]
}

/**
 * 노션 · 수집기 단계 문자열 → 상태(v2, 2026-11-26). 옛 이름(검토 · 불참 · 제출 · 선정)과 새 이름표 둘 다 받는다.
 * 검토는 없어져 준비로, 불참은 중단으로 간다
 */
const STAGES: Record<string, GrantStage> = {
  검토: "PREPARING",
  준비: "PREPARING",
  제출: "SUBMITTED",
  "제출 완료": "SUBMITTED",
  선정: "SELECTED",
  선정됨: "SELECTED",
  미선정: "REJECTED",
  "수행 중": "IN_PROGRESS",
  수행중: "IN_PROGRESS",
  완료: "COMPLETED",
  "수행 완료": "COMPLETED",
  불참: "STOPPED",
  중단: "STOPPED",
}

/**
 * 보유 → HELD, 조사에서 미충족 → STOPPED(중단, 2026-11-28 인증 단계 — 옛 NOT_ELIGIBLE), 나머지(충족 · 확인 필요) → 후보.
 * 준비 · 신청 · 심사 중은 사람이 인증 탭에서 정한다 — 이식은 그 단계를 만들지 않고, 사람이 고친 단계는 덮지 않는다(scripts/import-grants.ts)
 */
export function certStatus(item: CertItem): CertStage {
  const our = item.research?.our_status
  if (item.held || our === "보유") return "HELD"
  if (our === "미충족") return "STOPPED"
  return "CANDIDATE"
}

export function grantStage(label: string): GrantStage {
  const s = STAGES[label]
  if (!s) throw new Error(`알 수 없는 단계: ${label}`)
  return s
}

export function certRow(item: CertItem, researchedAt: Date | null) {
  const examples = item.research?.bonus_examples
  return {
    externalKey: item.key,
    name: item.name,
    officialName: item.research?.official_name ?? null,
    issuer: item.issuer || null,
    status: certStatus(item),
    priority: item.priority || null,
    difficulty: item.difficulty || null,
    bonus: <Prisma.InputJsonObject>{
      medibio: item.bonus_medibio || null,
      mss: item.bonus_mss || null,
      examples: examples ?? null,
    },
    research: item.research
      ? ({
          ...item.research,
          notionRequirement: item.requirement ?? null,
          notionCost: item.cost ?? null,
        } as Prisma.InputJsonObject)
      : undefined,
    researchedAt: item.research ? researchedAt : null,
    note: item.note || null,
  }
}

export function decisionRow(item: DecisionItem) {
  return {
    externalKey: item.key,
    title: item.title,
    stage: grantStage(item.stage),
    stageReason: item.stage_reason ?? null,
    statusRaw: item.status_raw ?? null,
    submittedTitle: item.submitted_title ?? null,
    note: item.note ?? null,
    noticeLinks: item.notice_links?.length
      ? (item.notice_links as Prisma.InputJsonArray)
      : undefined,
  }
}

/** 보유 인증을 연혁 MILESTONE 제목에 잇는다 — 인증 이름의 핵심 낱말(「인증·확인」 을 뺀 것)이 제목에 하나만 있으면 */
export function matchMilestone(
  certName: string,
  records: { id: string; title: string }[]
): string | null {
  const core = certName.replace(/\s|인증|확인|\(.*?\)/g, "")
  if (core.length < 2) return null
  let hits = records.filter((r) => r.title.replace(/\s/g, "").includes(core))
  // 「벤처기업 … 선정」 처럼 같은 낱말이 든 다른 연혁이 있으면 「인증」 이 든 줄만 본다
  if (hits.length > 1) hits = hits.filter((r) => /인증|인정|확인/.test(r.title))
  return hits.length === 1 ? hits[0].id : null
}

type Judgement = {
  verdict?: string
  reasons?: { claim?: string; quote?: string }[]
}
export type NoticeItem = {
  key: string
  title: string
  members?: { source?: string; url?: string; url_kind?: string }[]
  attachments?: { name: string; url?: string | null; type?: string | null }[]
  org_ministry?: string | null
  org_agency?: string | null
  rcpt_start_at?: string | null
  deadline_at?: string | null
  deadline_raw?: string | null
  first_seen?: string | null
  last_seen?: string | null
  index?: {
    region_class?: string
    region_detail?: string[]
    fields?: string[]
    is_rnd?: boolean | null
  }
  judgements?: {
    llm?: { sole?: Judgement; corp?: Judgement }
    rules?: { sole?: Judgement; corp?: Judgement }
  }
}

const date = (s?: string | null) => (s ? new Date(s) : null)
const reasons = (j?: Judgement) =>
  j?.reasons?.length
    ? (j.reasons.map((r) => ({
        claim: r.claim ?? "",
        quote: r.quote ?? "",
      })) as Prisma.InputJsonArray)
    : undefined

/** 공고 한 건 → GrantNotice. 사람이 읽은 판정(llm)이 있으면 그것을, 없으면 규칙 판정을 쓴다 */
export function noticeRow(
  item: NoticeItem,
  sizeByUrl: Map<string, number> = new Map()
) {
  const llm = item.judgements?.llm
  const useLlm = Boolean(llm?.sole?.verdict || llm?.corp?.verdict)
  const j = useLlm ? llm! : (item.judgements?.rules ?? {})
  const url =
    item.members?.find((m) => m.url_kind === "detail")?.url ??
    item.members?.find((m) => m.url)?.url ??
    null
  return {
    externalKey: item.key,
    title: item.title,
    ministry: item.org_ministry || null,
    agency: item.org_agency || null,
    url,
    rcptStartAt: date(item.rcpt_start_at),
    deadlineAt: date(item.deadline_at),
    deadlineRaw: item.deadline_raw || null,
    regionClass: item.index?.region_class ?? null,
    regionDetail: item.index?.region_detail ?? [],
    fields: item.index?.fields ?? [],
    isRnd: item.index?.is_rnd ?? null,
    verdictSole: j.sole?.verdict ?? null,
    verdictCorp: j.corp?.verdict ?? null,
    reasonsSole: reasons(j.sole),
    reasonsCorp: reasons(j.corp),
    judgedBy: useLlm ? "llm" : item.judgements?.rules ? "rules" : null,
    attachments: noticeAttachments(item, sizeByUrl),
    firstSeen: date(item.first_seen),
    lastSeen: date(item.last_seen),
  }
}

export type NoticeAttachment = {
  name: string
  type: string | null
  size: number | null
  url: string
  page?: string
}

/** 기업마당(bizinfo) 첨부 주소 — 그대로는 403 이고, 공고 페이지가 주는 새 토큰 주소로 받아야 한다 */
export const isBizinfoFile = (url: string) =>
  /bizinfo\.go\.kr\/cmm\/fms\/getImageFile\.do/.test(url)

/** 파일 이름 끝으로 형식 — hwp · hwpx · pdf · zip · xlsx · docx · jpg … */
export function fileType(name: string, given?: string | null): string | null {
  const ext = name.match(/\.([A-Za-z0-9]{2,5})$/)?.[1]?.toLowerCase()
  if (ext) return ext === "jpeg" ? "jpg" : ext
  return given && given !== "image" ? given : null
}

/** 공고 첨부 → 화면 · 도구가 쓸 모양. 이름이 같은 것은 하나만 */
export function noticeAttachments(
  item: NoticeItem,
  sizeByUrl: Map<string, number>
): Prisma.InputJsonArray | undefined {
  const bizinfoPage =
    item.members?.find((m) => m.source === "bizinfo" && m.url_kind === "detail")
      ?.url ?? item.members?.find((m) => m.source === "bizinfo")?.url
  const seen = new Set<string>()
  const out: NoticeAttachment[] = []
  for (const a of item.attachments ?? []) {
    if (!a.url || seen.has(a.name)) continue
    seen.add(a.name)
    out.push({
      name: a.name,
      type: fileType(a.name, a.type),
      size: sizeByUrl.get(a.url) ?? null,
      url: a.url,
      ...(isBizinfoFile(a.url) && bizinfoPage ? { page: bizinfoPage } : {}),
    })
  }
  return out.length ? (out as unknown as Prisma.InputJsonArray) : undefined
}
