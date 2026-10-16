/**
 * 칼럼 키워드 후보 수집 — 피드 읽기 → Gemini 가 주제로 묶기 → 기존 라이브러리와 대조 → 저장.
 *
 * 설계: mydocs/plans/2026-10-16-column-keyword-pipeline.md
 *
 * 출처가 지어지지 않게 하는 것이 핵심이다. 모델에게는 번호 붙인 헤드라인만 주고, 키워드마다
 * 근거 번호(sources: [3, 17])만 돌려받는다. URL·매체·날짜는 그 번호로 피드 항목에서 꺼낸다.
 * 없는 번호를 대면 버리고, 근거가 하나도 남지 않은 키워드는 저장하지 않는다.
 */
import { createHash } from "node:crypto"

import { prisma } from "@/lib/db"
import { callGemini, embedTexts } from "@/lib/ai"

import { fetchAllFeeds, type FeedItem, type FeedResult } from "./feeds"

export const TOPICS = ["정책", "규제", "산업", "투자", "연구", "기술"] as const
export type Topic = (typeof TOPICS)[number]

export interface KeywordSource {
  title: string
  url: string
  publisher: string
  date: string | null
}

export interface KeywordCandidate {
  term: string
  normalized: string
  topic: Topic
  summary: string
  sources: KeywordSource[]
  timelyAt: string | null
  nearestPostId: string | null
  nearestTitle: string | null
  nearestScore: number | null
  /** 이미 저장된 같은 키워드가 있으면 그 id — 새로 만들지 않고 근거·시의성만 갱신한다 */
  existingId: string | null
  /** 의미로 같은 주제라 합친 기존 키워드의 표현 */
  matchedTerm?: string
  usedCount: number
  score: number
}

export interface CollectResult {
  runId: string | null
  items: number
  results: FeedResult[]
  candidates: KeywordCandidate[]
  dropped: { term: string; why: string }[]
  model: string
  durationMs: number
  cpuMs: number
  /** 단계별 시간 — 어디서 오래 걸리는지 */
  timings: Record<string, number>
}

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.6-flash"
/**
 * 이보다 비슷하면 카드에 ⚠ 를 띄운다. 설계안은 0.8 이었지만 첫 실측(2026-10-16, 후보 30건)에서
 * gemini-embedding 유사도가 0.78~0.90 에 몰려 0.8 이면 거의 전부 경고였다. 실제로 겹친 주제
 * (바이오의약품 수출 0.888 · CGT 규제 완화 0.898 · NK세포치료제 0.867)와 안 겹친 주제(0.78~0.85)
 * 사이에 둔다.
 */
export const SIMILAR_WARN = 0.86
/**
 * 키워드끼리 이보다 비슷하면 같은 주제로 본다(표현만 다른 것). 같은 날 두 번 수집해 짝지은 실측
 * (2026-10-16): 같은 주제는 0.898~0.991, 다른 주제는 0.884 이하였다. 글자 비교(normalized)만으로는
 * 다시 돌릴 때마다 표현을 바꾼 키워드가 새로 쌓였다(30건 중 29건).
 */
export const SAME_TOPIC = 0.895
/** 유사도를 새로움 0~1 로 펴는 구간. 이 아래는 완전히 새로움, 위는 0 */
const SIM_FLOOR = 0.78
const SIM_CEIL = 0.92

/**
 * 추천 점수. 설계 문서의 식(새로움 + 시의성 − 사용 횟수 벌점)에 근거 수 가점을 더했다.
 * 키워드 보드(GET)와 수집이 같은 식을 쓴다.
 */
export function scoreKeyword(k: {
  nearestScore: number | null
  timelyAt: Date | string | null
  sourceCount: number
  usedCount: number
  reservedByOther?: boolean
  now?: number
}): number {
  const sim = k.nearestScore ?? SIM_FLOOR
  const novelty = Math.min(1, Math.max(0, (SIM_CEIL - sim) / (SIM_CEIL - SIM_FLOOR)))
  const ageDays = k.timelyAt ? ((k.now ?? Date.now()) - new Date(k.timelyAt).getTime()) / 86_400_000 : 14
  const timeliness = Math.max(0, 1 - ageDays / 14)
  const score =
    novelty * 1.5 + timeliness + Math.min(k.sourceCount, 4) * 0.1 - k.usedCount * 0.7 - (k.reservedByOther ? 1 : 0)
  return Math.round(score * 1000) / 1000
}

export const normalizeTerm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")

const cosine = (a: number[], b: number[]) => {
  let s = 0
  for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]
  return s // 둘 다 L2 정규화돼 있다(embedTexts)
}

const plain = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()

function buildPrompt(items: FeedItem[], usedTerms: string[]): string {
  const lines = items.map((it, i) => `[${i}] ${it.title} (${it.publisher}${it.date ? `, ${it.date.slice(0, 10)}` : ""})`)
  return `당신은 바이오 소재 스타트업 HADD Science 의 홈페이지 칼럼 편집자다.
아래는 최근 2주 바이오·정책 헤드라인 ${items.length}건이다. 각 줄 앞의 [번호]가 근거 번호다.

칼럼 주제로 쓸 키워드를 30~40개 골라라.
- 주제는 바이오 전반과 정부 지원·규제 동향이다. 특정 질환·치료제 하나에만 매달리지 말고 고르게 뽑는다.
- 키워드는 칼럼 한 편의 주제가 될 만한 크기로 쓴다. 너무 넓은 말("바이오 산업")도, 기사 제목 그대로도 안 된다.
  좋은 예: "국가통합바이오빅데이터 구축", "식약처 eCTD v4.0 전환", "오가노이드 기반 독성평가".
- 헤드라인 두 건 이상이 받치는 주제를 우선한다. 한 건뿐이면 시의성이 아주 클 때만.
- 광고·웨비나·채용·주가 단신은 근거로 쓰지 않는다.
- topic 은 ${TOPICS.join(" · ")} 중 하나.
- summary 는 사실만 2문장. 누가 무엇을 했고 무엇이 바뀌는지만 쓴다. 문자열 안에서 큰따옴표(")를 쓰지 않는다.
  헤드라인에 없는 숫자·사실을 만들지 않는다. 평가·전망 문장("~가 부각된다", "~가 주목된다", "~가 기대된다",
  "~할 만하다", "~이 필요하다", "~로 떠올랐다")으로 끝내지 않는다.
- sources 는 근거 번호 배열(1~5개). URL 을 쓰지 말고 번호만.
${usedTerms.length ? `- 이미 쓴 키워드와 같은 것은 빼라: ${usedTerms.join(", ")}\n` : ""}
JSON 배열만 출력한다:
[{"term":"...","topic":"정책","summary":"...","sources":[0,5]}]

헤드라인:
${lines.join("\n")}`
}

interface RawKeyword {
  term?: unknown
  topic?: unknown
  summary?: unknown
  sources?: unknown
}

function parseKeywords(raw: string): RawKeyword[] {
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) throw new Error("키워드 응답에 JSON 배열이 없다")
  const parsed = JSON.parse(m[0]) as unknown
  if (!Array.isArray(parsed)) throw new Error("키워드 응답이 배열이 아니다")
  return parsed as RawKeyword[]
}

/** 라이브러리 글의 임베딩을 캐시에서 꺼내고, 없거나 바뀐 글만 새로 만든다. */
async function libraryEmbeddings(userId: string, useCache: boolean) {
  const posts = await prisma.websitePost.findMany({ where: { category: "library" }, select: { id: true, content: true } })
  const rows = posts.map((p) => {
    const ko = (p.content as { ko?: { title?: string; summary?: string } }).ko ?? {}
    const text = plain(`${ko.title ?? ""}\n${ko.summary ?? ""}`)
    return { id: p.id, title: plain(ko.title ?? ""), text, hash: createHash("sha256").update(text).digest("hex").slice(0, 16) }
  })
  const cached = new Map(
    (useCache ? await prisma.columnPostEmbedding.findMany() : []).map((c) => [c.postId, c] as const)
  )
  const stale = rows.filter((r) => r.text && cached.get(r.id)?.contentHash !== r.hash)
  if (stale.length) {
    const vecs = await embedTexts(stale.map((r) => r.text), "RETRIEVAL_DOCUMENT", userId)
    if (useCache) await prisma.$transaction(
      stale.map((r, i) =>
        prisma.columnPostEmbedding.upsert({
          where: { postId: r.id },
          create: { postId: r.id, contentHash: r.hash, embedding: vecs[i] },
          update: { contentHash: r.hash, embedding: vecs[i] },
        })
      )
    )
    stale.forEach((r, i) => cached.set(r.id, { postId: r.id, contentHash: r.hash, embedding: vecs[i], updatedAt: new Date() }))
  }
  return { rows, cached, embeddedNow: stale.length }
}

/**
 * 후보를 모아 점수순으로 돌려준다. dryRun 이면 칼럼 테이블을 읽지도 쓰지도 않는다 —
 * 마이그레이션 전의 운영 DB 에서도 라이브러리 글만 읽어 돌려 볼 수 있게. 임베딩은 매번 새로 만든다.
 */
export async function collectKeywords(opts: { userId: string; dryRun?: boolean; now?: Date }): Promise<CollectResult> {
  const t0 = Date.now()
  const c0 = process.cpuUsage()
  const timings: Record<string, number> = {}
  const lap = (name: string, since: number) => (timings[name] = Date.now() - since)

  let t = Date.now()
  const { items, results } = await fetchAllFeeds(opts.now)
  lap("feeds", t)
  if (items.length < 10) throw new Error(`헤드라인이 ${items.length}건뿐이다 — 피드를 확인할 것`)

  const existing = opts.dryRun
    ? []
    : await prisma.columnKeyword.findMany({
        select: {
          id: true, term: true, normalized: true, status: true, embedding: true, sources: true,
          drafts: { where: { status: "published" }, select: { id: true } },
        },
      })
  const byNorm = new Map(existing.map((k) => [k.normalized, k]))
  const usedTerms = existing.filter((k) => k.drafts.length > 0 || k.status === "used").map((k) => k.term)

  t = Date.now()
  const prompt = buildPrompt(items, usedTerms)
  let raw = await callGemini(prompt, "columnKeywords", opts.userId, 0.4, { model: MODEL, json: true })
  let rawKeywords: RawKeyword[]
  try {
    rawKeywords = parseKeywords(raw)
  } catch (e) {
    // 문자열 안의 따옴표를 풀지 않은 JSON 이 가끔 온다. 한 번만 다시 묻는다
    console.error("[column] 키워드 응답 파싱 실패, 한 번 더 묻는다", e instanceof Error ? e.message : e)
    if (process.env.COLUMN_DEBUG_FILE) (await import("node:fs")).writeFileSync(process.env.COLUMN_DEBUG_FILE, raw)
    raw = await callGemini(
      `${prompt}\n\n주의: 올바른 JSON 만 출력한다. 문자열 안에서 큰따옴표를 쓰지 말고 작은따옴표나 「」를 쓴다.`,
      "columnKeywords",
      opts.userId,
      0.2,
      { model: MODEL, json: true }
    )
    rawKeywords = parseKeywords(raw)
    timings.geminiRetry = 1
  }
  lap("gemini", t)

  const dropped: { term: string; why: string }[] = []
  const picked: Omit<KeywordCandidate, "nearestPostId" | "nearestTitle" | "nearestScore" | "score">[] = []
  const seen = new Set<string>()
  for (const k of rawKeywords) {
    const term = typeof k.term === "string" ? k.term.trim() : ""
    if (!term) continue
    const normalized = normalizeTerm(term)
    if (seen.has(normalized)) {
      dropped.push({ term, why: "같은 실행 안에서 중복" })
      continue
    }
    const idx = Array.isArray(k.sources) ? k.sources.filter((n): n is number => Number.isInteger(n)) : []
    const sources = idx.filter((n) => n >= 0 && n < items.length).map((n) => items[n])
    if (!sources.length) {
      dropped.push({ term, why: `근거 번호가 없거나 범위 밖(${JSON.stringify(k.sources)})` })
      continue
    }
    const topic = (TOPICS as readonly string[]).includes(k.topic as string) ? (k.topic as Topic) : "산업"
    const dates = sources.map((s) => s.date).filter((d): d is string => !!d).sort()
    const prev = byNorm.get(normalized)
    seen.add(normalized)
    picked.push({
      term,
      normalized,
      topic,
      summary: typeof k.summary === "string" ? k.summary.trim() : "",
      sources: sources.map(({ title, url, publisher, date }) => ({ title, url, publisher, date })),
      timelyAt: dates.at(-1) ?? null,
      existingId: prev?.id ?? null,
      usedCount: prev?.drafts.length ?? 0,
    })
  }

  t = Date.now()
  const lib = await libraryEmbeddings(opts.userId, !opts.dryRun)
  const kwVecs = await embedTexts(picked.map((p) => `${p.term}\n${p.summary}`), "RETRIEVAL_DOCUMENT", opts.userId)
  lap("embed", t)
  timings.libraryEmbeddedNow = lib.embeddedNow

  // 의미로 중복 거르기 — 기존 키워드와 같은 주제면 그 행을 갱신하고, 같은 실행 안에서 겹치면 뒤엣것을 버린다
  const keep: number[] = []
  for (let i = 0; i < picked.length; i++) {
    const dup = keep.find((j) => cosine(kwVecs[i], kwVecs[j]) >= SAME_TOPIC)
    if (dup !== undefined) {
      dropped.push({ term: picked[i].term, why: `같은 실행의 「${picked[dup].term}」 와 같은 주제` })
      continue
    }
    if (!picked[i].existingId) {
      let best: { k: (typeof existing)[number]; s: number } | null = null
      for (const k of existing) {
        if (!k.embedding.length) continue
        const sim = cosine(kwVecs[i], k.embedding)
        if (!best || sim > best.s) best = { k, s: sim }
      }
      if (best && best.s >= SAME_TOPIC) {
        picked[i].existingId = best.k.id
        picked[i].usedCount = best.k.drafts.length
        picked[i].matchedTerm = best.k.term
      }
    }
    keep.push(i)
  }

  const now = (opts.now ?? new Date()).getTime()
  const candidates: KeywordCandidate[] = keep.map((i) => picked[i]).map((p) => {
    const i = picked.indexOf(p)
    let best: { id: string; score: number } | null = null
    for (const r of lib.rows) {
      const v = lib.cached.get(r.id)?.embedding
      if (!v?.length) continue
      const s = cosine(kwVecs[i], v)
      if (!best || s > best.score) best = { id: r.id, score: s }
    }
    const nearestScore = best ? Math.round(best.score * 1000) / 1000 : null
    return {
      ...p,
      nearestPostId: best?.id ?? null,
      nearestTitle: best ? (lib.rows.find((r) => r.id === best.id)?.title ?? null) : null,
      nearestScore,
      score: scoreKeyword({ nearestScore, timelyAt: p.timelyAt, sourceCount: p.sources.length, usedCount: p.usedCount, now }),
    }
  })
  candidates.sort((a, b) => b.score - a.score)

  let runId: string | null = null
  if (!opts.dryRun) {
    t = Date.now()
    const run = await prisma.columnKeywordRun.create({
      data: { model: MODEL, sources: results as object, createdById: opts.userId },
    })
    runId = run.id
    for (const c of candidates) {
      const data = {
        topic: c.topic,
        summary: c.summary,
        sources: c.sources as object,
        timelyAt: c.timelyAt ? new Date(c.timelyAt) : null,
        embedding: kwVecs[picked.findIndex((p) => p.normalized === c.normalized)] ?? [],

        nearestPostId: c.nearestPostId,
        nearestScore: c.nearestScore,
      }
      if (c.existingId) {
        // 표현은 처음 것을 지킨다. 근거는 합치고 새 것을 앞에 둔다
        const prev = existing.find((k) => k.id === c.existingId)
        const prevSources = (Array.isArray(prev?.sources) ? prev.sources : []) as unknown as KeywordSource[]
        const merged = [...c.sources, ...prevSources].filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i).slice(0, 8)
        await prisma.columnKeyword.update({
          where: { id: c.existingId },
          data: { sources: merged as object, timelyAt: data.timelyAt, nearestPostId: c.nearestPostId, nearestScore: c.nearestScore },
        })
      }
      else await prisma.columnKeyword.create({ data: { ...data, runId, term: c.term, normalized: c.normalized } })
    }
    lap("save", t)
  }

  const durationMs = Date.now() - t0
  const cpu = process.cpuUsage(c0)
  const cpuMs = Math.round((cpu.user + cpu.system) / 1000)
  if (runId) {
    await prisma.columnKeywordRun.update({ where: { id: runId }, data: { finishedAt: new Date(), durationMs, cpuMs } })
  }
  return { runId, items: items.length, results, candidates, dropped, model: MODEL, durationMs, cpuMs, timings }
}
