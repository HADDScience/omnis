// 연혁 제안 — 채팅 · 업무에서 회사 연혁 후보를 찾아 사람에게 올린다.
//
// 흐름: 대화 → Gemini 가 후보 추출(종류 · 등급 · 대외비) → 기존 연혁 · 제안과 날짜 ±7일 + 제목으로 대조 →
// RecordProposal(PENDING) → 사람이 채택 · 수정 · 제외 → CompanyRecord.
//
// 원안 그대로 채택한 비율이 종류 × 등급별로 쌓이고, 기준을 넘은 유형만 자동 등록으로 넘어간다.
// 「주요」 등급과 대외비는 정확도와 관계없이 계속 사람이 확인한다 — 외부로 나가는 자료가 여기서 갈린다.
//
// 배경: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md
import { prisma } from "@/lib/db"
import { callGemini } from "@/lib/ai"
import { writeActivity } from "@/lib/api"
import { recordData, recordDedupeKey } from "@/lib/company-edit"
import { CompanyRecordSchema, RECORD_KINDS, RECORD_KIND_LABEL } from "@/lib/schemas/company"
import type { Prisma, RecordGrade, RecordKind } from "@/generated/prisma/client"

// ─── 기준 ────────────────────────────────────────────────────────

/** 자동 등록으로 넘어가려면 그 유형에서 사람이 판단한 건수가 이만큼 쌓여야 한다 */
export const AUTO_MIN_DECIDED = 20
/** 그리고 원안 그대로 채택한 비율이 이 이상 */
export const AUTO_MIN_RATE = 0.9
/** 그리고 가장 최근 판단이 이만큼 연달아 원안 그대로 채택 */
export const AUTO_STREAK = 3
/** 같은 사건으로 보는 날짜 폭 */
export const DUP_WINDOW_DAYS = 7

const DAY_MS = 86_400_000
const CONFIDENTIAL_PREFIX = "[내부용·대외비] "
const CONFIDENTIAL_NOTE = "외부 자료 사용 금지"

// ─── 같은 사건인가 (결정적 — scripts/verify-record-proposals.ts 가 잰다) ──

/** 제목에서 비교에 쓸 글자만 남긴다. 괄호 · 기호 · 「대외비」 접두어를 뗀다 */
export function normalizeTitle(s: string): string {
  return s
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[()（）「」『』<>《》·・,.:;!?'"“”‘’\-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** 글자 두 개씩 묶음. 한국어는 띄어쓰기가 들쭉날쭉해 낱말보다 이쪽이 잘 맞는다 */
function bigrams(s: string): Set<string> {
  const t = normalizeTitle(s).replace(/\s/g, "")
  const out = new Set<string>()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}

/** 두 제목의 겹침 (0~1, Jaccard) */
export function titleSimilarity(a: string, b: string): number {
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  return inter / (A.size + B.size - inter)
}

/**
 * 같은 사건인가. 날짜가 둘 다 있으면 ±7일 안이고 제목이 0.3 이상 겹칠 때.
 * 한쪽 날짜가 없으면 제목만으로 보되 더 엄하게(0.6) — 날짜 없는 옛 연혁이 새 사건을 다 막지 않게.
 */
export function isSameEvent(
  a: { title: string; date: Date | null },
  b: { title: string; date: Date | null }
): boolean {
  const sim = titleSimilarity(a.title, b.title)
  if (a.date && b.date) {
    return Math.abs(a.date.getTime() - b.date.getTime()) <= DUP_WINDOW_DAYS * DAY_MS && sim >= 0.3
  }
  return sim >= 0.6
}

// ─── 정확도 · 자동 전환 (결정적) ───────────────────────────────────

export interface Decision {
  kind: RecordKind
  grade: RecordGrade
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "AUTO_APPLIED" | "SUPERSEDED"
  edited: boolean
  revertedAt: Date | null
  decidedAt: Date | null
}

export interface TypeStats {
  kind: RecordKind
  grade: RecordGrade
  /** 사람이 판단한 건수 (채택 · 수정 채택 · 제외 · 자동 등록을 되돌림) */
  decided: number
  /** 그중 원안 그대로 채택 */
  matched: number
  rate: number | null
  /** 가장 최근부터 연달아 원안 그대로 채택한 건수 */
  streak: number
  /** 자동 등록 중인가 */
  auto: boolean
}

/** 사람의 판단만 센다 — 되돌리지 않은 자동 등록은 사람이 본 게 아니라 근거가 아니다 */
function humanVerdict(d: Decision): "match" | "miss" | null {
  if (d.status === "ACCEPTED") return d.edited ? "miss" : "match"
  if (d.status === "REJECTED") return "miss"
  if (d.status === "AUTO_APPLIED" && d.revertedAt) return "miss"
  return null
}

export function typeStats(decisions: Decision[]): TypeStats[] {
  const groups = new Map<string, Decision[]>()
  for (const d of decisions) {
    const k = `${d.kind}:${d.grade}`
    groups.set(k, [...(groups.get(k) ?? []), d])
  }
  const out: TypeStats[] = []
  for (const [key, list] of groups) {
    const [kind, grade] = key.split(":") as [RecordKind, RecordGrade]
    const judged = list
      .map((d) => ({ v: humanVerdict(d), at: (d.revertedAt ?? d.decidedAt)?.getTime() ?? 0 }))
      .filter((x): x is { v: "match" | "miss"; at: number } => x.v !== null)
      .sort((a, b) => b.at - a.at)
    const matched = judged.filter((x) => x.v === "match").length
    let streak = 0
    for (const x of judged) {
      if (x.v !== "match") break
      streak++
    }
    const rate = judged.length ? matched / judged.length : null
    out.push({
      kind,
      grade,
      decided: judged.length,
      matched,
      rate,
      streak,
      auto:
        grade === "GENERAL" &&
        judged.length >= AUTO_MIN_DECIDED &&
        rate !== null &&
        rate >= AUTO_MIN_RATE &&
        streak >= AUTO_STREAK,
    })
  }
  return out.sort((a, b) => b.decided - a.decided)
}

/** 이 제안을 사람 확인 없이 등록해도 되나. 주요 등급 · 대외비는 언제나 사람이 본다 */
export function canAutoApply(p: { kind: RecordKind; grade: RecordGrade; confidential: boolean }, stats: TypeStats[]): boolean {
  if (p.grade !== "GENERAL" || p.confidential) return false
  return stats.some((s) => s.kind === p.kind && s.grade === p.grade && s.auto)
}

export async function loadTypeStats(): Promise<TypeStats[]> {
  const rows = await prisma.recordProposal.findMany({
    where: { status: { in: ["ACCEPTED", "REJECTED", "AUTO_APPLIED"] } },
    select: { kind: true, grade: true, status: true, edited: true, revertedAt: true, decidedAt: true },
  })
  return typeStats(rows)
}

// ─── 제안 → 연혁 한 줄 (결정적) ───────────────────────────────────

export interface ProposalFields {
  kind: RecordKind
  grade: RecordGrade
  confidential: boolean
  title: string
  occurredOn: Date | null
  periodRaw: string | null
  organizer: string | null
}

/** 연혁 표에 넣을 값. 대외비면 제목 접두어 · 비고 · 공개범위를 함께 단다 */
export function recordInputFrom(p: ProposalFields, opts: { auto: boolean; today?: Date }) {
  const today = opts.today ?? new Date()
  const title = p.confidential && !p.title.startsWith("[내부용") ? `${CONFIDENTIAL_PREFIX}${p.title}` : p.title
  const notes = [
    "Omnis 연혁 제안에서 등록",
    opts.auto ? "자동 등록 — 사후 검토 대상" : null,
    p.confidential ? CONFIDENTIAL_NOTE : null,
  ].filter(Boolean)
  return {
    kind: p.kind,
    title,
    organizer: p.organizer,
    startsOn: p.occurredOn ? p.occurredOn.toISOString().slice(0, 10) : null,
    endsOn: null,
    periodRaw: p.periodRaw,
    status: p.occurredOn && p.occurredOn.getTime() > today.getTime() ? "계획" : "완료",
    note: notes.join(" · "),
    // 엑셀 원문 분류 칸 — 「주요」는 기업현황카드 후보라는 뜻으로 그대로 쓴다
    category: p.grade === "MAJOR" ? "주요" : null,
    visibility: p.confidential ? ("INTERNAL" as const) : ("PUBLIC" as const),
  }
}

// ─── 추출 (Gemini) ───────────────────────────────────────────────

interface Msg {
  id: string
  at: Date
  author: string
  content: string
  task: string | null
}

interface RawCandidate {
  kind?: string
  grade?: string
  confidential?: boolean
  title?: string
  date?: string | null
  period?: string | null
  organizer?: string | null
  evidence?: number[]
  reason?: string
  confidence?: number
}

const kst = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 16)

function extractionPrompt(msgs: Msg[], context: string, existing: string): string {
  const lines = msgs.map((m, i) => `[${i + 1}] ${kst(m.at)} ${m.author}${m.task ? ` (업무: ${m.task})` : ""}: ${m.content.slice(0, 600)}`)
  return `당신은 HADD Science 의 회사 연혁을 관리합니다. 아래 사내 대화에서 **회사 연혁에 남길 사건**을 찾으세요.
오늘은 ${kst(new Date()).slice(0, 10)} 입니다. ${context}

## 종류 (kind)
${RECORD_KINDS.map((k) => `- ${k}: ${RECORD_KIND_LABEL[k]}`).join("\n")}
(GRANT 지원사업 선정 · AWARD 수상 · EXHIBITION 학회·전시·부스 · FORUM 포럼·세미나 참석/발표 · EDUCATION 교육 · NETWORKING 네트워킹·기관 방문 · INTERNAL 내부행사·입주·워크샵 · MILESTONE 협약/MOU·출원/등록·인증·위촉·설립 같은 주요 사건)

## 등급 (grade)
- MAJOR 주요: 외부에 내세울 **기관 확정 성과** — 선정 · 수상 · 협약/MOU · 출원/등록 · 인증 · 기관 위촉
- GENERAL 일반: 상세 연혁에만 — 행사 참석 · 부스 · 발표 · 교육 · 현장점검 · 실사
- EXCLUDE 제외: 다음은 연혁이 아니다
  - 개인 활동 (대표·직원의 사적인 멘토링 · 강의 등 회사 명의가 아닌 것)
  - 비공개 영업 미팅 (특정 기업 방문 · 줌 미팅)
  - 결과가 없는 「신청」 (선정 전까지는 연혁이 아니다 — 선정되면 그때 GRANT)
  - 계획만 있고 확정되지 않은 일, 내부 업무 처리 (서류 작성 · 견적 · 발주)

## 대외비 (confidential)
대화에 「비밀」「대외비」「아직 공개 X」「외부에 말하지 말 것」 같은 말이 그 사건에 걸려 있으면 true.

## 이미 있는 연혁 (같은 사건이면 내지 마세요)
${existing || "(없음)"}

## 대화
${lines.join("\n")}

규칙:
- 대화에 **실제로 일어났거나 확정된** 사건만. 짐작하지 마세요. 없으면 빈 배열.
- 같은 사안에 말이 바뀌었으면 날짜가 늦은 말을 따릅니다.
- date 는 사건이 일어난 날(YYYY-MM-DD). 대화한 날이 아닙니다. 모르면 null. 기간이면 period 에 원문(예: 2026.12.02~12.05)도 적습니다.
- title 은 연혁 한 줄로 — 「기관 + 사건」 (예: 「경기도경제과학진흥원 2026 바이오 기술사업화 지원사업 선정」).
- evidence 는 근거가 된 대화 번호. 반드시 1개 이상.
- EXCLUDE 도 적으세요 — 왜 뺐는지 reason 에 한 줄.

반드시 JSON 만:
{"candidates": [{"kind": "AWARD", "grade": "MAJOR|GENERAL|EXCLUDE", "confidential": false, "title": "…", "date": "YYYY-MM-DD", "period": null, "organizer": "주관 기관", "evidence": [3, 5], "reason": "한 줄", "confidence": 0.0~1.0}]}`
}

async function existingNearby(msgs: Msg[]): Promise<{ title: string; date: Date | null }[]> {
  const first = msgs[0]?.at ?? new Date()
  const last = msgs.at(-1)?.at ?? new Date()
  // 사건 날짜는 대화 날짜와 다를 수 있다(지난 수상을 오늘 이야기한다) — 넉넉히 1년 앞뒤를 본다
  const rows = await prisma.companyRecord.findMany({
    where: {
      OR: [
        { startsOn: { gte: new Date(first.getTime() - 365 * DAY_MS), lte: new Date(last.getTime() + 365 * DAY_MS) } },
        { startsOn: null },
      ],
    },
    select: { title: true, startsOn: true },
  })
  return rows.map((r) => ({ title: r.title, date: r.startsOn }))
}

/** 대화 묶음 하나에서 후보를 뽑아 제안으로 남긴다. 반환: 만든 수 · 버린 이유별 수 */
export async function proposeFromMessages(
  msgs: Msg[],
  opts: { trigger: string; triggerTaskId?: string; context?: string; userId?: string }
): Promise<{ created: number; skipped: Record<string, number> }> {
  const skipped: Record<string, number> = {}
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1)
  if (msgs.length === 0) return { created: 0, skipped: { "대화 없음": 1 } }

  const nearby = await existingNearby(msgs)
  const existingText = nearby
    .filter((r) => r.date)
    .sort((a, b) => b.date!.getTime() - a.date!.getTime())
    .slice(0, 80)
    .map((r) => `- ${r.date!.toISOString().slice(0, 10)} ${r.title}`)
    .join("\n")

  let raw: string
  try {
    raw = await callGemini(extractionPrompt(msgs, opts.context ?? "", existingText), "recordPropose", opts.userId, 0.1)
  } catch (err) {
    console.error("[record-proposals] 추출 실패", err)
    return { created: 0, skipped: { "추출 실패": 1 } }
  }
  const m = raw.match(/\{[\s\S]*\}/)
  let candidates: RawCandidate[] = []
  try {
    candidates = m ? ((JSON.parse(m[0]) as { candidates?: RawCandidate[] }).candidates ?? []) : []
  } catch {
    return { created: 0, skipped: { "응답 해석 실패": 1 } }
  }

  const pending = await prisma.recordProposal.findMany({
    where: { status: { in: ["PENDING", "ACCEPTED", "REJECTED", "AUTO_APPLIED"] } },
    select: { title: true, occurredOn: true },
  })
  const stats = await loadTypeStats()

  let created = 0
  for (const c of candidates) {
    if (c.grade === "EXCLUDE") {
      skip("제외 등급")
      continue
    }
    const kind = RECORD_KINDS.find((k) => k === c.kind)
    const grade = c.grade === "MAJOR" || c.grade === "GENERAL" ? c.grade : null
    const title = typeof c.title === "string" ? c.title.trim().slice(0, 300) : ""
    if (!kind || !grade || !title) {
      skip("형식 오류")
      continue
    }
    const evidence = (c.evidence ?? []).map((n) => msgs[n - 1]).filter((x): x is Msg => !!x)
    if (evidence.length === 0) {
      skip("근거 없음")
      continue
    }
    const occurredOn = typeof c.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.date) ? new Date(`${c.date}T00:00:00Z`) : null
    const me = { title, date: occurredOn }
    // 이미 있는 연혁 · 이미 올린(또는 거절된) 제안과 같은 사건이면 다시 올리지 않는다
    if (nearby.some((r) => isSameEvent(me, r))) {
      skip("이미 있는 연혁")
      continue
    }
    if (pending.some((p) => isSameEvent(me, { title: p.title, date: p.occurredOn }))) {
      skip("이미 올린 제안")
      continue
    }

    const fields: ProposalFields = {
      kind,
      grade,
      confidential: c.confidential === true,
      title,
      occurredOn,
      periodRaw: typeof c.period === "string" && c.period.trim() ? c.period.trim().slice(0, 100) : null,
      organizer: typeof c.organizer === "string" && c.organizer.trim() ? c.organizer.trim().slice(0, 200) : null,
    }
    const sourceRefs = [
      ...(opts.triggerTaskId ? [{ kind: "task", id: opts.triggerTaskId, label: evidence[0].task ?? "업무" }] : []),
      ...evidence.map((e) => ({
        kind: "message",
        id: e.id,
        label: `${e.author} ${kst(e.at).slice(0, 10)}`,
        at: e.at.toISOString().slice(0, 10),
        quote: e.content.slice(0, 200),
      })),
    ]
    const proposal = await prisma.recordProposal.create({
      data: {
        ...fields,
        confidence: Math.min(1, Math.max(0, Number(c.confidence) || 0)),
        reason: typeof c.reason === "string" ? c.reason.slice(0, 300) : "",
        sourceRefs: sourceRefs as unknown as Prisma.InputJsonValue,
        original: { ...fields, occurredOn: fields.occurredOn?.toISOString().slice(0, 10) ?? null } as unknown as Prisma.InputJsonValue,
        trigger: opts.trigger,
        triggerTaskId: opts.triggerTaskId ?? null,
      },
    })
    pending.push({ title, occurredOn })
    created++

    if (canAutoApply(fields, stats)) {
      await acceptRecordProposal(proposal.id, { auto: true })
    }
  }
  return { created, skipped }
}

/** 업무가 끝났을 때 그 대화 전체를 본다 (카드 제안과 같은 자리에서 부른다) */
export async function proposeRecordsFromTask(taskId: string, opts: { userId?: string } = {}) {
  const already = await prisma.recordProposal.count({ where: { triggerTaskId: taskId } })
  if (already > 0) return { created: 0, skipped: { "이미 처리한 업무": 1 } }
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      name: true,
      messages: {
        where: { kind: "NORMAL", deletedAt: null },
        orderBy: { createdAt: "asc" },
        take: 300,
        select: { id: true, content: true, createdAt: true, author: { select: { name: true } } },
      },
    },
  })
  if (!task) return { created: 0, skipped: { "업무 없음": 1 } }
  const msgs = task.messages
    .filter((m) => !m.content.startsWith("__"))
    .map((m) => ({ id: m.id, at: m.createdAt, author: m.author.name, content: m.content, task: task.name }))
  return proposeFromMessages(msgs, { trigger: "task_done", triggerTaskId: task.id, userId: opts.userId, context: `업무 「${task.name}」 가 완료됐습니다.` })
}

export function proposeRecordsFromTaskSafe(taskId: string, opts: { userId?: string } = {}): void {
  void proposeRecordsFromTask(taskId, opts).catch((err) => console.error("[record-proposals] 업무 제안 실패", { taskId, err }))
}

/** 하루치 채팅 (업무 안팎 전부). 크론이 부른다 */
export async function proposeRecordsFromChat(since: Date, until = new Date()) {
  const rows = await prisma.chatMessage.findMany({
    where: { createdAt: { gte: since, lt: until }, kind: "NORMAL", deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: 600,
    select: { id: true, content: true, createdAt: true, author: { select: { name: true } }, task: { select: { name: true } } },
  })
  const msgs = rows
    .filter((m) => !m.content.startsWith("__") && m.content.trim().length >= 4)
    .map((m) => ({ id: m.id, at: m.createdAt, author: m.author.name, content: m.content, task: m.task?.name ?? null }))
  // 한 번에 너무 길면 나눈다 — 대화 300개 단위
  let created = 0
  const skipped: Record<string, number> = {}
  for (let i = 0; i < msgs.length; i += 300) {
    const r = await proposeFromMessages(msgs.slice(i, i + 300), { trigger: "chat_daily", context: "하루치 사내 채팅입니다." })
    created += r.created
    for (const [k, v] of Object.entries(r.skipped)) skipped[k] = (skipped[k] ?? 0) + v
  }
  return { messages: msgs.length, created, skipped }
}

// ─── 판단 ───────────────────────────────────────────────────────

export type ProposalEdits = Partial<Omit<ProposalFields, "occurredOn">> & { occurredOn?: string | null }

/**
 * 채택한다. edits 가 원안과 다르면 「수정 채택」으로 남긴다 — 정확도에서는 원안과 다름으로 센다.
 * auto 면 사람 확인 없이 등록한 것으로 남긴다.
 */
export async function acceptRecordProposal(
  id: string,
  opts: { userId?: string; auto?: boolean; edits?: ProposalEdits } = {}
): Promise<{ recordId: string } | { error: string }> {
  const p = await prisma.recordProposal.findUnique({ where: { id } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if (p.status !== "PENDING") return { error: `이미 처리된 제안입니다 (${p.status})` }

  const e = opts.edits ?? {}
  const next: ProposalFields = {
    kind: e.kind && RECORD_KINDS.includes(e.kind) ? e.kind : p.kind,
    grade: e.grade === "MAJOR" || e.grade === "GENERAL" ? e.grade : p.grade,
    confidential: typeof e.confidential === "boolean" ? e.confidential : p.confidential,
    title: typeof e.title === "string" && e.title.trim() ? e.title.trim() : p.title,
    occurredOn:
      e.occurredOn === undefined ? p.occurredOn : e.occurredOn && /^\d{4}-\d{2}-\d{2}$/.test(e.occurredOn) ? new Date(`${e.occurredOn}T00:00:00Z`) : null,
    periodRaw: e.periodRaw === undefined ? p.periodRaw : e.periodRaw || null,
    organizer: e.organizer === undefined ? p.organizer : e.organizer || null,
  }
  const edited =
    next.kind !== p.kind ||
    next.grade !== p.grade ||
    next.confidential !== p.confidential ||
    next.title !== p.title ||
    (next.occurredOn?.getTime() ?? null) !== (p.occurredOn?.getTime() ?? null) ||
    next.periodRaw !== p.periodRaw ||
    next.organizer !== p.organizer

  const parsed = CompanyRecordSchema.safeParse(recordInputFrom(next, { auto: !!opts.auto }))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "잘못된 값" }
  const data = recordData(parsed.data)
  const dedupeKey = recordDedupeKey({
    kind: data.kind,
    title: data.title,
    organizer: data.organizer,
    partner: data.partner,
    startsOn: parsed.data.startsOn,
    periodRaw: data.periodRaw,
  })

  try {
    const record = await prisma.$transaction(async (tx) => {
      const r = await tx.companyRecord.create({ data: { dedupeKey, source: "옴니스 제안", ...data } })
      await tx.recordProposal.update({
        where: { id },
        data: {
          ...next,
          edited,
          status: opts.auto ? "AUTO_APPLIED" : "ACCEPTED",
          decidedById: opts.auto ? null : (opts.userId ?? null),
          decidedAt: new Date(),
          recordId: r.id,
        },
      })
      return r
    })
    await writeActivity({
      userId: opts.userId,
      action: "company.record.created",
      entity: "COMPANY_RECORD",
      entityId: record.id,
      title: `${opts.auto ? "연혁 자동 등록" : edited ? "연혁 제안 수정 채택" : "연혁 제안 채택"}: [${RECORD_KIND_LABEL[record.kind]}] ${record.title}`,
      metadata: { via: "record-proposal", proposalId: id },
    })
    return { recordId: record.id }
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return { error: "같은 연혁이 이미 있습니다 — 제외로 처리하세요" }
    throw err
  }
}

export async function rejectRecordProposal(id: string, userId?: string): Promise<{ ok: true } | { error: string }> {
  const p = await prisma.recordProposal.findUnique({ where: { id }, select: { status: true } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if (p.status !== "PENDING") return { error: `이미 처리된 제안입니다 (${p.status})` }
  await prisma.recordProposal.update({
    where: { id },
    data: { status: "REJECTED", decidedById: userId ?? null, decidedAt: new Date() },
  })
  return { ok: true }
}

/** 채택 · 자동 등록을 되돌린다 — 만든 연혁을 지우고 정확도에 「원안과 다름」으로 남긴다 */
export async function revertRecordProposal(id: string, userId?: string): Promise<{ ok: true } | { error: string }> {
  const p = await prisma.recordProposal.findUnique({ where: { id } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if ((p.status !== "ACCEPTED" && p.status !== "AUTO_APPLIED") || p.revertedAt) return { error: "되돌릴 수 있는 제안이 아닙니다" }
  await prisma.$transaction(async (tx) => {
    if (p.recordId) await tx.companyRecord.deleteMany({ where: { id: p.recordId } })
    await tx.recordProposal.update({
      where: { id },
      // 사람이 채택한 것을 되돌리면 그 판단을 거절로 바꾼다. 자동 등록은 revertedAt 이 「원안과 다름」을 뜻한다
      data: p.status === "ACCEPTED" ? { status: "REJECTED", revertedAt: new Date(), recordId: null } : { revertedAt: new Date(), recordId: null },
    })
  })
  await writeActivity({
    userId,
    action: "company.record.deleted",
    entity: "COMPANY_RECORD",
    entityId: p.recordId ?? id,
    title: `연혁 제안 되돌림: ${p.title}`,
    metadata: { via: "record-proposal", proposalId: id },
  })
  return { ok: true }
}
