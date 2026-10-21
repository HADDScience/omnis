/**
 * 칼럼 초안 — 생성 · 상태 전이 · 게시.
 *
 * 설계: mydocs/plans/2026-10-16-column-keyword-pipeline.md
 *
 * 상태: draft → in_review → (approved | changes_requested → draft…) → published
 * 승인은 대표님(COLUMN_REVIEWERS, 기본 "허채정")만 한다. 게시는 승인된 초안만.
 *
 * 초안의 `postId` 는 **만들 때 정한다.** 편집 중 올리는 사진이 그 id 아래(NAS website/<id>/)에
 * 저장되기 때문이다. 게시 전까지 같은 id 의 WebsitePost 는 없다.
 */
import { prisma } from "@/lib/db"
import { callGemini } from "@/lib/ai"
import { createNotification } from "@/lib/notifications"
import { PostBlockSchema, PostInputSchema, type PostBlock } from "@/lib/schemas/website"
import { savePost } from "@/lib/website-posts"

import { readArticle } from "./article"
import type { KeywordSource } from "./collect"
import { IMAGE_SUGGEST_INSTRUCTIONS, toImageSuggestions, type ImageSuggestion } from "./image-suggest"

const MODEL = process.env.GEMINI_COLUMN_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.6-flash"

export const DRAFT_STATUS = ["draft", "in_review", "changes_requested", "approved", "published"] as const
export type DraftStatus = (typeof DRAFT_STATUS)[number]

export class DraftError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

/** 검토·승인할 수 있는 사람(이름). 2026-10-16 결정: 대표님만. */
export function reviewerNames(): string[] {
  return (process.env.COLUMN_REVIEWERS ?? "허채정").split(",").map((s) => s.trim()).filter(Boolean)
}
export const isReviewer = (name: string) => reviewerNames().includes(name)

/** KST 기준 "20261016-1432". 이미 쓰인 id 면 1분씩 민다(WebsitePost · 다른 초안 모두와 대조). */
async function reservePostId(now = new Date()): Promise<string> {
  for (let bump = 0; bump < 120; bump++) {
    const kst = new Date(now.getTime() + 9 * 3600_000 + bump * 60_000)
    const p = (n: number) => String(n).padStart(2, "0")
    const id = `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}-${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`
    const [post, draft] = await Promise.all([
      prisma.websitePost.findUnique({ where: { id }, select: { id: true } }),
      prisma.columnDraft.findUnique({ where: { postId: id }, select: { id: true } }),
    ])
    if (!post && !draft) return id
  }
  throw new DraftError("id_exhausted", "기사 id 를 정하지 못했습니다", 500)
}

export function todayKst(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 3600_000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${kst.getUTCFullYear()}.${p(kst.getUTCMonth() + 1)}.${p(kst.getUTCDate())}`
}

interface RawDraft {
  title?: unknown
  summary?: unknown
  leadImage?: unknown
  sections?: { heading?: unknown; paragraphs?: unknown; image?: unknown }[]
}

function buildPrompt(k: { term: string; summary: string }, sources: { i: number; s: KeywordSource; text: string }[]): string {
  const blocks = sources
    .map(({ i, s, text }) =>
      `[${i}] ${s.title} — ${s.publisher}${s.date ? `, ${s.date.slice(0, 10)}` : ""}\n${text || "(본문을 읽지 못했다. 제목만 근거로 쓴다)"}`
    )
    .join("\n\n")
  return `당신은 바이오 소재 스타트업 HADD Science(하드사이언스)의 홈페이지 「하드:라이브러리」 칼럼 필자다.
주제 키워드: ${k.term}
주제 설명: ${k.summary}

아래 근거 기사만 사용해 한국어 칼럼 초안을 쓴다.
- 독자는 바이오 업계 실무자·연구자·투자자. 뉴스 요약이 아니라, 무엇이 바뀌었고 업계에 어떤 의미인지 정리하는 칼럼이다.
- 분량: 소제목 3~4개, 전체 1,500~2,500자.
- 사실·숫자·인용은 근거 기사에 있는 것만 쓴다. 문장 끝에 근거 번호를 [1] 처럼 단다. 근거에 없는 숫자는 쓰지 않는다.
- 근거가 말하지 않는 해석은 「~로 보인다」처럼 필자의 판단임이 드러나게 쓰고 번호를 달지 않는다.
- 하드사이언스 홍보 문장을 넣지 않는다. 회사가 근거에 나오지 않으면 회사 이야기를 하지 않는다.
- 문자열 안에서 큰따옴표(")를 쓰지 않는다. 인용은 「」를 쓴다.
- title: 40자 안팎. summary: 한 문장 부제(80자 이내).

${IMAGE_SUGGEST_INSTRUCTIONS}

JSON 하나만 출력한다:
{"title":"...","summary":"...","leadImage":{"idea":"...","sources":["..."],"prompt":"..."},"sections":[{"heading":"...","paragraphs":["...","..."],"image":{"idea":"...","sources":["..."],"prompt":"..."}}]}

근거 기사:
${blocks}`
}

function toBlocks(raw: RawDraft, sources: { i: number; s: KeywordSource; url: string }[]): PostBlock[] {
  const blocks: PostBlock[] = []
  for (const sec of raw.sections ?? []) {
    if (typeof sec.heading === "string" && sec.heading.trim()) blocks.push({ type: "heading", text: sec.heading.trim() })
    const paras = Array.isArray(sec.paragraphs) ? sec.paragraphs.filter((p): p is string => typeof p === "string" && !!p.trim()) : []
    if (paras.length) blocks.push({ type: "text", text: paras.map((p) => p.trim()).join("\n\n") })
  }
  blocks.push({
    type: "links",
    title: "참고 기사",
    items: sources.map(({ i, s, url }) => ({ label: `[${i}] ${s.publisher} — ${s.title}`, href: url })),
  })
  return blocks.map((b) => PostBlockSchema.parse(b))
}

/**
 * 키워드 하나로 초안을 만든다. 근거 기사 본문을 읽어(최대 5건) Gemini 에 준다.
 * 만든 사람이 그 키워드를 예약한 것으로 기록한다.
 */
export async function generateDraft(keywordId: string, userId: string) {
  const t0 = Date.now()
  const c0 = process.cpuUsage()
  const k = await prisma.columnKeyword.findUnique({ where: { id: keywordId } })
  if (!k) throw new DraftError("not_found", "키워드를 찾지 못했습니다", 404)
  if (k.status === "discarded") throw new DraftError("discarded", "버린 키워드입니다")
  if (k.status === "reserved" && k.reservedById && k.reservedById !== userId) {
    throw new DraftError("reserved_by_other", "다른 사람이 예약한 키워드입니다", 409)
  }
  const all = (Array.isArray(k.sources) ? k.sources : []) as unknown as KeywordSource[]
  if (!all.length) throw new DraftError("no_sources", "근거 기사가 없습니다")

  const picked = all.slice(0, 5).map((s, n) => ({ i: n + 1, s }))
  const read = await Promise.all(picked.map(async (p) => ({ ...p, ...(await readArticle(p.s.url)) })))
  // 출력 한도: callGemini 의 maxOutputTokens 8192 · thinkingBudget 1024(column*)를 그대로 쓴다.
  // 제안 없던 초안 실측(로컬 GeminiUsage, 2026-10-16 3건)은 출력 730~885 토큰, 생각 0.
  // 제안(맨 앞 1 + 소제목 3~4)은 건당 한국어 두 칸 + 영문 프롬프트 한 단락이라 약 250~300 토큰 → +1,500 안팎.
  // 본문이 상한(2,500자)까지 가고 생각을 예산만큼 다 써도 약 4,500 토큰으로 8192 안이다.
  // 잘리면 아래 JSON.parse 가 bad_model_output(응답 길이 포함)으로 떨어진다 — 그때 이 추정을 다시 본다.
  const raw = await callGemini(buildPrompt(k, read), "columnDraft", userId, 0.5, { model: MODEL, json: true })
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) throw new DraftError("bad_model_output", "초안 응답을 읽지 못했습니다", 502)
  let parsed: RawDraft
  try {
    parsed = JSON.parse(m[0]) as RawDraft
  } catch (e) {
    if (process.env.COLUMN_DEBUG_FILE) (await import("node:fs")).writeFileSync(process.env.COLUMN_DEBUG_FILE, raw)
    throw new DraftError("bad_model_output", `초안 응답이 올바른 JSON 이 아닙니다(${raw.length}자): ${e instanceof Error ? e.message : e}`, 502)
  }
  const blocks = toBlocks(parsed, read)
  const imageSuggestions = toImageSuggestions(parsed)
  const unread = read.filter((r) => !r.text).length
  if (unread) {
    blocks.unshift({
      type: "quote",
      text: `근거 ${read.length}건 중 ${unread}건은 본문을 읽지 못해 제목만으로 썼습니다. 그 번호가 달린 문장은 원문을 열어 확인해 주세요. (게시 전에 이 상자를 지우세요)`,
    })
  }

  const postId = await reservePostId()
  const durationMs = Date.now() - t0
  const cpu = process.cpuUsage(c0)
  const draft = await prisma.$transaction(async (tx) => {
    const d = await tx.columnDraft.create({
      data: {
        keywordId,
        createdById: userId,
        title: typeof parsed.title === "string" ? parsed.title.trim() : k.term,
        summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
        blocks: blocks as object,
        imageSuggestions: imageSuggestions as object[],
        model: MODEL,
        postId,
        durationMs,
        cpuMs: Math.round((cpu.user + cpu.system) / 1000),
      },
    })
    if (k.status === "candidate") {
      await tx.columnKeyword.update({ where: { id: keywordId }, data: { status: "reserved", reservedById: userId, reservedAt: new Date() } })
    }
    return d
  })
  return { draft, sourcesRead: read.map((r) => ({ i: r.i, resolved: r.resolved, chars: r.text.length })) }
}

const EDITABLE: DraftStatus[] = ["draft", "changes_requested"]

/** `imageSuggestions` 를 안 보내면(옛 편집기) 저장된 제안을 그대로 둔다. */
export async function updateDraft(
  id: string,
  input: { title: string; summary: string; blocks: PostBlock[]; imageSuggestions?: ImageSuggestion[] }
) {
  const d = await prisma.columnDraft.findUnique({ where: { id } })
  if (!d) throw new DraftError("not_found", "초안을 찾지 못했습니다", 404)
  if (!EDITABLE.includes(d.status as DraftStatus)) throw new DraftError("not_editable", "검토 중이거나 게시된 초안은 고칠 수 없습니다", 409)
  return prisma.columnDraft.update({
    where: { id },
    data: {
      title: input.title,
      summary: input.summary,
      blocks: input.blocks as object,
      ...(input.imageSuggestions ? { imageSuggestions: input.imageSuggestions as object[] } : {}),
    },
  })
}

/**
 * 검토 요청 전에 막을 것: 출처 없는 사진, 게시 전에 지우라는 안내 상자, 빈 본문.
 * 이미지 제안(`imageSuggestions`)은 보지 않는다 — 블록이 아니라서 사진으로 세지도, 막지도 않는다.
 */
export function reviewProblems(d: { title: string; blocks: unknown }): string[] {
  const blocks = (Array.isArray(d.blocks) ? d.blocks : []) as PostBlock[]
  const out: string[] = []
  if (!d.title.trim()) out.push("제목이 비어 있습니다")
  if (!blocks.some((b) => b.type === "text" && b.text.trim())) out.push("본문이 비어 있습니다")
  // 첫 사진이 목록 썸네일이 된다. 썸네일 없는 글은 관리 화면 현황에서 「손볼 것」으로 잡힌다
  if (!blocks.some((b) => b.type === "image")) out.push("사진이 없습니다 — 첫 사진이 목록 썸네일이 됩니다")
  blocks.forEach((b, i) => {
    if (b.type === "image" && !b.caption?.trim()) out.push(`${i + 1}번째 블록(사진)에 출처가 없습니다`)
    if (b.type === "quote" && b.text.includes("게시 전에 이 상자를 지우세요")) out.push("「본문을 읽지 못한 근거」 안내 상자가 남아 있습니다")
  })
  return out
}

export async function requestReview(id: string, user: { id: string; name: string }) {
  const d = await prisma.columnDraft.findUnique({ where: { id } })
  if (!d) throw new DraftError("not_found", "초안을 찾지 못했습니다", 404)
  if (!EDITABLE.includes(d.status as DraftStatus)) throw new DraftError("bad_state", "지금 상태에서는 검토를 요청할 수 없습니다", 409)
  const problems = reviewProblems(d)
  if (problems.length) throw new DraftError("not_ready", problems.join(" · "))
  const updated = await prisma.columnDraft.update({ where: { id }, data: { status: "in_review", reviewNote: null } })
  const reviewers = await prisma.user.findMany({ where: { name: { in: reviewerNames() }, isActive: true }, select: { id: true } })
  for (const r of reviewers) {
    await createNotification(r.id, "column_review", "칼럼 검토 요청", `${user.name} — ${d.title}`, d.id)
  }
  return updated
}

export async function decide(id: string, user: { id: string; name: string }, decision: "approve" | "request_changes", note?: string) {
  if (!isReviewer(user.name)) throw new DraftError("not_reviewer", "검토 권한이 없습니다(대표님만 승인합니다)", 403)
  const d = await prisma.columnDraft.findUnique({ where: { id } })
  if (!d) throw new DraftError("not_found", "초안을 찾지 못했습니다", 404)
  if (d.status !== "in_review") throw new DraftError("bad_state", "검토 중인 초안이 아닙니다", 409)
  const updated = await prisma.columnDraft.update({
    where: { id },
    data: { status: decision === "approve" ? "approved" : "changes_requested", reviewerId: user.id, reviewNote: note?.trim() || null },
  })
  await createNotification(
    d.createdById,
    "column_decision",
    decision === "approve" ? "칼럼이 승인됐습니다" : "칼럼 수정 요청",
    `${d.title}${note?.trim() ? ` — ${note.trim()}` : ""}`,
    d.id
  )
  return updated
}

/** 본문의 근거 번호([1])를 지운다 — 검토용 표시라 공개 글에는 남기지 않는다. 참고 기사 목록의 번호는 남긴다. */
export function stripCitations(blocks: PostBlock[]): PostBlock[] {
  return blocks.map((b) =>
    b.type === "text" || b.type === "quote" ? { ...b, text: b.text.replace(/\s?\[\d+(?:[,\s]*\d+)*\]/g, "") } : b
  )
}

/**
 * 초안 → WebsitePost 저장 요청. 제목·부제·블록만 읽는다 — 이미지 제안·검토 메모 같은
 * 검토용 칸은 여기서 걸러져 공개 글에 닿지 않는다.
 */
export function publishInput(d: { title: string; summary: string; blocks: unknown }) {
  const blocks = stripCitations(d.blocks as PostBlock[])
  const firstImage = blocks.find((b): b is Extract<PostBlock, { type: "image" }> => b.type === "image")
  return PostInputSchema.parse({
    category: "library",
    date: todayKst(),
    sourceLang: "ko",
    thumbnail: firstImage?.src ?? null,
    externalHref: null,
    content: { ko: { title: d.title, summary: d.summary, blocks } },
  })
}

/** 승인된 초안을 라이브러리 글로 저장한다. 영문은 savePost 가 번역한다. */
export async function publishDraft(id: string, userId: string) {
  const d = await prisma.columnDraft.findUnique({ where: { id } })
  if (!d) throw new DraftError("not_found", "초안을 찾지 못했습니다", 404)
  if (d.status !== "approved") throw new DraftError("not_approved", "대표님 승인을 받은 초안만 게시할 수 있습니다", 409)
  if (!d.postId) throw new DraftError("no_post_id", "기사 id 가 없습니다", 500)
  if (await prisma.websitePost.findUnique({ where: { id: d.postId }, select: { id: true } })) {
    throw new DraftError("already_exists", "같은 id 의 기사가 이미 있습니다", 409)
  }
  const input = publishInput(d)
  const { post, translationFailures } = await savePost(d.postId, input, userId)
  await prisma.$transaction([
    prisma.columnDraft.update({ where: { id }, data: { status: "published" } }),
    prisma.columnKeyword.update({ where: { id: d.keywordId }, data: { status: "used" } }),
  ])
  return { post, translationFailures }
}

/** 게시 전 초안을 버린다. 그 키워드에 남은 초안이 없으면 예약을 푼다. */
export async function discardDraft(id: string) {
  const d = await prisma.columnDraft.findUnique({ where: { id } })
  if (!d) throw new DraftError("not_found", "초안을 찾지 못했습니다", 404)
  if (d.status === "published") throw new DraftError("published", "게시된 초안은 지울 수 없습니다", 409)
  await prisma.columnDraft.delete({ where: { id } })
  const left = await prisma.columnDraft.count({ where: { keywordId: d.keywordId } })
  if (!left) {
    await prisma.columnKeyword.updateMany({
      where: { id: d.keywordId, status: "reserved" },
      data: { status: "candidate", reservedById: null, reservedAt: null },
    })
  }
}
