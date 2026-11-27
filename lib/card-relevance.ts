// 카톡 이식 카드 다듬기 — 카드에 붙은 글 가운데 무관한 글을 떼고, 제목에 대상(무엇의 디자인 · 무엇의 자료인지)을 넣는다.
// 순수 모듈(DB · 네트워크 없음). 시험: lib/card-relevance.test.ts
//
// 근거: ~/work/omnis-reports/type-discovery/03-relevance-filter.md (2026-11-26)
// - 카드마다 「제목 · 배경 + 붙일 후보 글 + 앞뒤 2글 + 첨부 파일명 · 사진 설명」을 한 번 보내 글마다 관련(R) · 무관(U) · 애매를 받는다.
// - 정답지 323건에서 gemini-3.6-flash + 첨부 맥락이 정밀도 90% · 재현율 98% 였다(지금 방식은 58% · 100%).
// - 무관만 뗀다. 애매(unsure)와 판정이 빠진 글은 붙여 둔다. 글은 지우지 않고 카드 연결만 푼다 — 잘못 떼도 방에 남는다.
// - 규칙 거르기(「넵」 · 사진만 빼기)와 연결 보정은 넣지 않는다. 재현율이 78% 로 떨어지거나 인턴방 잡담을 끌어왔다.

/** 이보다 글이 적은 카드는 떼지 않는다 — 1~3글 카드는 지금 방식도 정밀도 100% 였다. 제목은 본다 */
export const MIN_MESSAGES_TO_JUDGE = 4
/** 앞뒤 맥락 글 수 — 시험과 같다 */
export const CONTEXT_EACH_SIDE = 2
/** 맥락 밖이라도 이 시간 안에 같은 방에 올라온 파일을 앞뒤로 붙인다(시험의 nearBefore · nearAfter) */
export const NEAR_FILE_MINUTES = 30
export const NEAR_FILES_EACH_SIDE = 2
/** 제목 글자 수 상한(카드 제목 칸) */
export const MAX_TITLE = 60

export interface CtxFile {
  name: string
  mime: string
  /** 사진이면 AI 사진 설명(File.description). 160자까지 */
  desc?: string | null
}

export interface CtxMessage {
  id: string
  /** KST "YYYY-MM-DD HH:mm" */
  at: string
  who: string
  text: string
  files: CtxFile[]
}

export interface NearFile extends CtxFile {
  at: string
  who: string
}

export interface CardMessage extends CtxMessage {
  before: (CtxMessage & { sameCard: boolean })[]
  after: (CtxMessage & { sameCard: boolean })[]
  nearBefore: NearFile[]
  nearAfter: NearFile[]
}

export interface CardInput {
  /** Task.id 또는 시험용 키 */
  key: string
  /** 전사방 · 인턴 단톡방 같은 방 이름 */
  room: string
  title: string
  background: string | null
  messages: CardMessage[]
  /** 새로 만든 카드만 이름을 고친다 — 기존 카드(이어 붙인 경우)는 사람이 고친 이름일 수 있다 */
  allowRename: boolean
}

export type Verdict = "R" | "U"

export interface ModelJudgment {
  id: string
  v: Verdict
  unsure: boolean
}

export interface ModelOutput {
  judgments: ModelJudgment[]
  title?: { name: string | null; basis?: string | null } | null
}

// ── 가리기 ──────────────────────────────────────────────

/**
 * 국내 전화번호(휴대폰 · 지역번호 · 대표번호 · +82). 영문 · 숫자에(하이픈으로라도) 붙은 숫자열은 뺀다 —
 * 링크 속 16진 id(「…d9e95199-1234」)를 번호로 가린 일이 있었다(2026-11-27 건식 비교)
 */
const PHONE = new RegExp(String.raw`(?:\+82[-. ]?|(?<![\dA-Za-z]|[\dA-Za-z]-))0?\d{1,2}[-. )]?\d{3,4}[-. ]\d{4}(?![\dA-Za-z]|-[\dA-Za-z])|(?<![\dA-Za-z]|[\dA-Za-z]-)01[016789]\d{7,8}(?![\dA-Za-z]|-[\dA-Za-z])|(?<![\dA-Za-z]|[\dA-Za-z]-)1[5-9]\d{2}-\d{4}(?![\dA-Za-z]|-[\dA-Za-z])`, "g")
const MAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

export interface MaskCount { phone: number; mail: number }

/** 보내기 전에 전화번호 · 메일을 가린다. 세는 값은 보고서용 */
export function maskContact(text: string, count?: MaskCount): string {
  return text
    .replace(MAIL, () => { if (count) count.mail++; return "(메일 가림)" })
    .replace(PHONE, () => { if (count) count.phone++; return "(전화번호 가림)" })
}

/** 문자열 칸을 모두 가린다. id · at 은 그대로 둔다 */
export function maskDeep<T>(value: T, count?: MaskCount): T {
  if (typeof value === "string") return maskContact(value, count) as T
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, count)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === "id" || k === "at" ? v : maskDeep(v, count)])) as T
  }
  return value
}

// ── 맥락 만들기 ─────────────────────────────────────────

export interface TimelineMessage extends CtxMessage {
  /** 정렬 · 시간 비교용 epoch ms */
  ms: number
}

/** 파일 글인가 — 첨부 행이 있거나 본문이 카톡 「File: 이름」 이다(옛 이식분은 원본 없이 본문만 있다) */
const fileOf = (m: TimelineMessage): CtxFile[] => {
  if (m.files.length) return m.files
  const f = /^File: (.+)/.exec(m.text.trim())
  return f ? [{ name: f[1].split("\n")[0].trim(), mime: "(카톡 파일 글, 원본 없음)" }] : []
}

/**
 * 방 타임라인(시간순) 에서 카드 입력을 만든다. candidateIds 는 카드에 붙일 후보 글(타임라인의 id).
 * 타임라인은 후보 앞뒤 맥락을 덮을 만큼 넉넉해야 한다(호출하는 쪽이 앞뒤 몇 시간을 읽는다).
 */
export function buildCardInput(args: {
  key: string; room: string; title: string; background: string | null; allowRename: boolean
  timeline: TimelineMessage[]; candidateIds: string[]
}): CardInput {
  const tl = [...args.timeline].sort((a, b) => a.ms - b.ms)
  const index = new Map(tl.map((m, i) => [m.id, i]))
  const picked = new Set(args.candidateIds)
  const strip = (m: TimelineMessage): CtxMessage => ({ id: m.id, at: m.at, who: m.who, text: m.text, files: m.files })
  const ctx = (m: TimelineMessage) => ({ ...strip(m), sameCard: picked.has(m.id) })
  const near = (from: number, step: 1 | -1, edgeMs: number): NearFile[] => {
    const out: NearFile[] = []
    for (let i = from; i >= 0 && i < tl.length && out.length < NEAR_FILES_EACH_SIDE; i += step) {
      if (Math.abs(tl[i].ms - edgeMs) > NEAR_FILE_MINUTES * 60_000) break
      for (const f of fileOf(tl[i])) if (out.length < NEAR_FILES_EACH_SIDE) out.push({ ...f, at: tl[i].at, who: tl[i].who })
    }
    return step === -1 ? out.reverse() : out
  }
  const messages: CardMessage[] = args.candidateIds
    .filter((id) => index.has(id))
    .sort((a, b) => index.get(a)! - index.get(b)!)
    .map((id) => {
      const i = index.get(id)!
      const lo = Math.max(0, i - CONTEXT_EACH_SIDE)
      const hi = Math.min(tl.length - 1, i + CONTEXT_EACH_SIDE)
      return {
        ...strip(tl[i]),
        before: tl.slice(lo, i).map(ctx),
        after: tl.slice(i + 1, hi + 1).map(ctx),
        nearBefore: near(lo - 1, -1, tl[lo].ms),
        nearAfter: near(hi + 1, 1, tl[hi].ms),
      }
    })
  return { key: args.key, room: args.room, title: args.title, background: args.background, allowRename: args.allowRename, messages }
}

// ── 요청 ────────────────────────────────────────────────

// 03-relevance-filter.md 의 flash.mjs 지시와 같은 내용이다(첨부 맥락 판). 제목 지시만 더했다.
const INSTRUCTION = `You are judging whether chat messages belong to a work card (업무 카드).

The input is one card: room (전사방 = company-wide room, 인턴 단톡방 = intern group chat), title, background, and messages: each attached message has id, at (KST), who, text ("" means a photo/file-only message), plus before/after = the 2 previous and 2 next messages in the same chat room (context only; sameCard=true means that neighbor is also attached to this card).
Each message (attached or neighbor) may also have files = files posted with it (name, mime type, and for photos an AI-written description; "Photo" text with no file means the photo itself is not available). Each attached message may also have nearBefore / nearAfter = up to 2 files posted in the same room within 30 minutes before / after its context.

TASK 1: For every attached message (not the before/after neighbors), decide:
- "R" = relevant: it is part of the work the card describes (the request, the work itself, files/photos for it, questions/answers/confirmations about THAT work, including a short "넵/알겠습니다" that clearly answers that card's request).
- "U" = unrelated: greetings, leaving-work chatter, jokes, other topics/other tasks that happened to be in the same time window, or an ack that answers a different topic.
Use the card title/background and the neighbors. For photo-only messages decide from context (who posted it, what is said right before/after, file names and photo descriptions). If truly undecidable, choose your best guess and set "unsure": true.

TASK 2 (title): Korean work-card titles must say WHAT the work is about, so that someone scanning a list knows which product, document, event, program, organization or person it concerns. Rename when the title's object is generic or deictic — e.g. "디자인 수정", "시안 검토", "자료 정리", "IR 자료 정리", "홍보물 수정", "파일 전달", "인쇄물 확인", "당일 행사 기사화", "오늘 행사 뉴스 게시", "특허 관련 미팅", "사진 건 처리" — and the attached messages, file names or photo descriptions name the specific target (the event's name, the program, the product, the document, the counterpart). The new title is Korean, at most 40 characters, keeps the original action words, and adds the target in front or puts it in place of the generic/deictic word, e.g. "디자인 수정" → "애드젤 리플렛 디자인 수정", "오늘 행사 뉴스 홈페이지 게시" → "DDC 딥테크 행사 뉴스 홈페이지 게시". Use only a target that literally appears in the messages, file names or photo descriptions; never invent one. Put the evidence (file name or short quote) in title.basis. If the title already names its target, or there is no single clear target, return title.name = null.

Return JSON {"judgments":[{"id":"<message id>","v":"R"|"U","unsure":true|false}],"title":{"name":string|null,"basis":string|null}} covering every attached message exactly once.`

export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    judgments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, v: { type: "STRING", enum: ["R", "U"] }, unsure: { type: "BOOLEAN" } },
        required: ["id", "v", "unsure"],
      },
    },
    title: {
      type: "OBJECT",
      properties: { name: { type: "STRING", nullable: true }, basis: { type: "STRING", nullable: true } },
      required: ["name"],
    },
  },
  required: ["judgments", "title"],
}

/**
 * 보낼 프롬프트. 글 id 는 짧은 번호(m1 …)로 바꿔 출력 토큰을 줄이고, 문자열은 전화번호 · 메일을 가린다.
 * 돌려받은 번호는 ids 로 원래 id 에 되짚는다.
 */
export function buildPrompt(card: CardInput, count?: MaskCount): { prompt: string; ids: Map<string, string> } {
  const short = new Map<string, string>()
  let n = 0
  const sid = (id: string) => { if (!short.has(id)) short.set(id, `m${++n}`); return short.get(id)! }
  const file = (f: CtxFile) => ({ name: f.name, mime: f.mime, ...(f.desc ? { desc: f.desc.slice(0, 160) } : {}) })
  const msg = (m: CtxMessage) => ({ id: sid(m.id), at: m.at, who: m.who, text: m.text, ...(m.files.length ? { files: m.files.map(file) } : {}) })
  const payload = {
    room: card.room,
    title: card.title,
    background: card.background ?? "",
    messages: card.messages.map((m) => ({
      ...msg(m),
      before: m.before.map((b) => ({ ...msg(b), sameCard: b.sameCard })),
      after: m.after.map((a) => ({ ...msg(a), sameCard: a.sameCard })),
      ...(m.nearBefore.length ? { nearBefore: m.nearBefore.map((f) => ({ ...file(f), at: f.at, who: f.who })) } : {}),
      ...(m.nearAfter.length ? { nearAfter: m.nearAfter.map((f) => ({ ...file(f), at: f.at, who: f.who })) } : {}),
    })),
  }
  const ids = new Map([...short].map(([orig, s]) => [s, orig]))
  return { prompt: `${INSTRUCTION}\n\nCARD:\n${JSON.stringify(maskDeep(payload, count))}`, ids }
}

/** 모델 응답 → 판정. 번호를 원래 id 로 되돌리고, 카드 후보가 아닌 id 와 중복은 버린다 */
export function parseOutput(text: string, ids: Map<string, string>, candidateIds: string[]): ModelOutput {
  let raw: unknown
  try { raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) } catch { throw new Error("판정 응답이 JSON 이 아니다") }
  const o = (raw ?? {}) as { judgments?: unknown; title?: unknown }
  const want = new Set(candidateIds)
  const seen = new Set<string>()
  const judgments: ModelJudgment[] = []
  for (const j of Array.isArray(o.judgments) ? o.judgments : []) {
    const r = j as { id?: unknown; v?: unknown; unsure?: unknown }
    const id = typeof r.id === "string" ? ids.get(r.id) ?? r.id : null
    if (!id || !want.has(id) || seen.has(id) || (r.v !== "R" && r.v !== "U")) continue
    seen.add(id)
    judgments.push({ id, v: r.v, unsure: r.unsure === true })
  }
  const t = (o.title ?? null) as { name?: unknown; basis?: unknown } | null
  const title = t && typeof t === "object"
    ? { name: typeof t.name === "string" && t.name.trim() ? t.name.trim() : null, basis: typeof t.basis === "string" ? t.basis : null }
    : null
  return { judgments, title }
}

// ── 결정 ────────────────────────────────────────────────

export interface Plan {
  keep: string[]
  drop: string[]
  /** 애매로 붙여 둔 글 */
  unsure: string[]
  /** 판정이 빠져 붙여 둔 글 */
  missing: string[]
  /** 글이 적어 판정하지 않은 카드 */
  judged: boolean
  /** 모든 글이 무관으로 나와 아무것도 떼지 않았다 */
  allUnrelated: boolean
  rename: { from: string; to: string; basis: string | null } | null
  /** 제목 제안을 받았지만 쓰지 않은 까닭 */
  renameRejected: string | null
}

/** 낱말 — 한글 · 영문 · 숫자 두 글자 이상 */
const words = (s: string) => (s.normalize("NFC").match(/[가-힣A-Za-z0-9]{2,}/g) ?? []).map((w) => w.toLowerCase())

/**
 * 제목 제안이 쓸 만한가. 지어낸 대상을 막는다.
 * - 원래 제목의 낱말을 하나 이상 남겨야 한다(하던 일의 이름은 그대로).
 * - 새로 더한 낱말 중 하나 이상이 글 · 파일명 · 사진 설명에 실제로 있어야 한다.
 */
export function checkRename(card: CardInput, name: string | null): { ok: true; name: string } | { ok: false; why: string } {
  if (!name) return { ok: false, why: "제안 없음" }
  const to = name.replace(/\s+/g, " ").trim()
  if (!card.allowRename) return { ok: false, why: "기존 카드" }
  if (to === card.title.trim()) return { ok: false, why: "같은 제목" }
  if (to.length > MAX_TITLE) return { ok: false, why: "너무 김" }
  const old = new Set(words(card.title))
  const next = words(to)
  if (old.size > 0 && !next.some((w) => old.has(w))) return { ok: false, why: "원래 제목 낱말이 없음" }
  const added = next.filter((w) => !old.has(w))
  if (added.length === 0) return { ok: false, why: "더한 대상 없음" }
  const source = card.messages
    .flatMap((m) => [m, ...m.before, ...m.after])
    .flatMap((m) => [m.text, ...m.files.flatMap((f) => [f.name, f.desc ?? ""])])
    .concat(card.messages.flatMap((m) => [...m.nearBefore, ...m.nearAfter].flatMap((f) => [f.name, f.desc ?? ""])))
    .concat(card.background ?? "")
    .join("\n").normalize("NFC").toLowerCase()
  if (!added.some((w) => source.includes(w))) return { ok: false, why: "더한 대상이 글 · 파일에 없음" }
  return { ok: true, name: to }
}

export function decide(card: CardInput, out: ModelOutput): Plan {
  const ids = card.messages.map((m) => m.id)
  const byId = new Map(out.judgments.map((j) => [j.id, j]))
  const judged = ids.length >= MIN_MESSAGES_TO_JUDGE
  const drop = judged ? ids.filter((id) => byId.get(id)?.v === "U" && !byId.get(id)!.unsure) : []
  const allUnrelated = judged && drop.length === ids.length
  const finalDrop = allUnrelated ? [] : drop
  const r = checkRename(card, out.title?.name ?? null)
  return {
    keep: ids.filter((id) => !finalDrop.includes(id)),
    drop: finalDrop,
    unsure: judged ? ids.filter((id) => byId.get(id)?.unsure) : [],
    missing: judged ? ids.filter((id) => !byId.has(id)) : [],
    judged,
    allUnrelated,
    rename: r.ok ? { from: card.title, to: r.name, basis: out.title?.basis ?? null } : null,
    renameRejected: r.ok ? null : out.title?.name ? r.why : null,
  }
}

/** 판정을 부를 가치가 있는가 — 글이 적어 떼지 않는 카드라도 이름을 고칠 수 있으면 부른다 */
export const worthCalling = (card: CardInput) => card.messages.length >= MIN_MESSAGES_TO_JUDGE || card.allowRename
