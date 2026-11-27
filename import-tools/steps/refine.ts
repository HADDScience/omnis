// 카드 다듬기 — 구조화가 카드에 붙인 글 가운데 무관한 글을 떼고, 새 카드 제목에 대상을 넣는다.
//
// 사진 설명(6단계) 뒤에 돈다. 판정에 파일명 · 사진 설명이 들어가야 해서다(첨부 맥락이 정밀도를 86% → 90% 로 올렸다).
// 판단 규칙은 lib/card-relevance.ts 에 있다. 여기서는 DB 에서 맥락을 읽고, Gemini 를 부르고, 결과를 반영한다.
//
// - 모델: KAKAO_RELEVANCE_MODEL(기본 gemini-3.6-flash). 호출은 lib/ai.ts callGemini 로 — GeminiUsage · AiUsage(feature "kakaoRelevance")에 남는다.
// - 무관(U)은 카드 연결(taskId)만 푼다. 글은 방에 그대로다. 애매와 판정이 빠진 글은 붙여 둔다.
// - 판정이 실패한 카드는 그대로 둔다(지금 방식과 같다). 이식 전체를 실패로 만들지 않는다.
// - 꺼 두려면 KAKAO_RELEVANCE=off 또는 kakao.ts --no-refine.
import type { Prisma, PrismaClient } from "../../generated/prisma"
import { callGemini } from "../../lib/ai"
import {
  RESPONSE_SCHEMA, buildCardInput, buildPrompt, decide, parseOutput, worthCalling,
  type CardInput, type MaskCount, type Plan, type TimelineMessage,
} from "../../lib/card-relevance"
import { prisma as defaultPrisma, runParallel } from "../kakao-common"
import type { Attached } from "./structure"

export const RELEVANCE_ENDPOINT = "kakaoRelevance"
export const relevanceModel = () => process.env.KAKAO_RELEVANCE_MODEL || "gemini-3.6-flash"
export const relevanceEnabled = () => process.env.KAKAO_RELEVANCE !== "off"

/** 카드 앞뒤로 읽는 방 글의 범위 — 맥락 2글과 30분 안 파일을 덮는다 */
const WINDOW_MS = 12 * 3600_000
const WINDOW_TAKE = 400

type Db = PrismaClient | Prisma.TransactionClient

const kst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 16).replace("T", " ")

export interface RefineTarget {
  taskId: string
  /** 판정할 글(ChatMessage.sourceId). 비우면 그 카드에 지금 붙은 글 전부 */
  sourceIds?: string[]
  created: boolean
}

/** 카드 입력을 DB 에서 읽는다. 읽기만 한다 — 건식 비교는 운영에서 READ ONLY 로 이것만 부른다 */
export async function loadCards(db: Db, targets: RefineTarget[]): Promise<CardInput[]> {
  const out: CardInput[] = []
  for (const t of targets) {
    const task = await db.task.findUnique({ where: { id: t.taskId }, select: { id: true, name: true, background: true } })
    if (!task) continue
    const candidates = await db.chatMessage.findMany({
      where: { taskId: task.id, deletedAt: null, ...(t.sourceIds ? { sourceId: { in: t.sourceIds } } : {}) },
      select: { id: true, roomId: true, createdAt: true, room: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    })
    if (candidates.length === 0) continue
    // 카드 글이 여러 방에 걸친 일은 없다(이식은 세션 = 한 방). 혹시 있으면 가장 많은 방만 본다
    const roomId = [...candidates.reduce((m, c) => m.set(c.roomId, (m.get(c.roomId) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0][0]
    const inRoom = candidates.filter((c) => c.roomId === roomId)
    const first = inRoom[0].createdAt.getTime()
    const last = inRoom[inRoom.length - 1].createdAt.getTime()
    const select = {
      id: true, content: true, createdAt: true,
      author: { select: { name: true } }, externalSpeaker: { select: { name: true } },
      files: { select: { name: true, mimeType: true, description: true }, orderBy: { createdAt: "asc" as const } },
    }
    const where = (gte: number, lte: number) => ({ roomId, deletedAt: null, createdAt: { gte: new Date(gte), lte: new Date(lte) } })
    // 앞 · 뒤를 따로 읽는다 — 큰 방에서 한쪽만 WINDOW_TAKE 를 다 먹지 않게
    const [beforeRows, middle, afterRows] = await Promise.all([
      db.chatMessage.findMany({ where: { ...where(first - WINDOW_MS, first), createdAt: { gte: new Date(first - WINDOW_MS), lt: new Date(first) } }, select, orderBy: { createdAt: "desc" }, take: 40 }),
      db.chatMessage.findMany({ where: where(first, last), select, orderBy: { createdAt: "asc" }, take: WINDOW_TAKE }),
      db.chatMessage.findMany({ where: { ...where(last, last + WINDOW_MS), createdAt: { gt: new Date(last), lte: new Date(last + WINDOW_MS) } }, select, orderBy: { createdAt: "asc" }, take: 40 }),
    ])
    const rows = [...beforeRows.reverse(), ...middle, ...afterRows]
    const timeline: TimelineMessage[] = rows.map((r) => ({
      id: r.id, ms: r.createdAt.getTime(), at: kst(r.createdAt),
      who: r.externalSpeaker?.name ?? r.author.name,
      text: r.content,
      files: r.files.map((f) => ({ name: f.name, mime: f.mimeType, desc: f.description?.slice(0, 160) ?? null })),
    }))
    out.push(buildCardInput({
      key: task.id, room: inRoom[0].room.name, title: task.name, background: task.background, allowRename: t.created,
      timeline, candidateIds: inRoom.map((c) => c.id),
    }))
  }
  return out
}

export interface Judged { card: CardInput; plan: Plan | null; error?: string }

/** 카드 하나를 판정한다. 실패하면 plan 이 null — 카드는 그대로 둔다 */
export async function judgeCard(card: CardInput, opts: { model?: string; mask?: MaskCount } = {}): Promise<Judged> {
  if (!worthCalling(card)) return { card, plan: decide(card, { judgments: [], title: null }) }
  try {
    const { prompt, ids } = buildPrompt(card, opts.mask)
    const text = await callGemini(prompt, RELEVANCE_ENDPOINT, undefined, 0, { model: opts.model ?? relevanceModel(), schema: RESPONSE_SCHEMA, thinkingLevel: "MINIMAL" })
    return { card, plan: decide(card, parseOutput(text, ids, card.messages.map((m) => m.id))) }
  } catch (e) {
    return { card, plan: null, error: (e as Error).message.slice(0, 200) }
  }
}

/** 판정 결과를 DB 에 반영한다. 뗄 글의 taskId 를 풀고, 이름을 고치고, sourceMessages 에 무엇을 뗐는지 남긴다 */
async function applyPlan(db: PrismaClient, j: Judged, model: string) {
  const plan = j.plan!
  if (plan.drop.length === 0 && !plan.rename) return
  const dropped = j.card.messages.filter((m) => plan.drop.includes(m.id))
  await db.$transaction(async (tx) => {
    if (plan.drop.length) await tx.chatMessage.updateMany({ where: { id: { in: plan.drop }, taskId: j.card.key }, data: { taskId: null } })
    const task = await tx.task.findUnique({ where: { id: j.card.key }, select: { sourceMessages: true } })
    const sm = (task?.sourceMessages ?? null) as { messages?: { t: string; u: string; m: string }[] } | null
    const gone = new Set(dropped.map((m) => `${m.at}|${m.text}`))
    const next = sm && typeof sm === "object" && !Array.isArray(sm)
      ? {
        ...sm,
        ...(Array.isArray(sm.messages) ? { messages: sm.messages.filter((m) => !gone.has(`${String(m.t).slice(0, 16)}|${m.m}`)) } : {}),
        relevance: {
          model, at: new Date().toISOString(),
          dropped: dropped.map((m) => ({ at: m.at, who: m.who, text: m.text.slice(0, 200) })),
          unsure: plan.unsure.length,
          ...(plan.rename ? { renamedFrom: plan.rename.from, renameBasis: plan.rename.basis } : {}),
        },
      }
      : undefined
    await tx.task.update({
      where: { id: j.card.key },
      data: { ...(plan.rename ? { name: plan.rename.to.slice(0, 120) } : {}), ...(next ? { sourceMessages: next as Prisma.InputJsonValue } : {}) },
    })
  })
}

export interface RefineReport {
  cards: number; judged: number; dropped: number; unsure: number; renamed: number; failed: number; allUnrelated: number
  /** 첫 몇 차례는 사람이 훑는다 — 뗀 글 목록 */
  droppedList: { taskId: string; title: string; at: string; who: string; text: string }[]
  renames: { taskId: string; from: string; to: string; basis: string | null }[]
}

export async function refineCards(attached: Attached[], opts: { dry: boolean; db?: PrismaClient }): Promise<RefineReport> {
  const db = opts.db ?? defaultPrisma
  const empty: RefineReport = { cards: 0, judged: 0, dropped: 0, unsure: 0, renamed: 0, failed: 0, allUnrelated: 0, droppedList: [], renames: [] }
  if (!relevanceEnabled()) { console.log("  KAKAO_RELEVANCE=off 로 건너뜀"); return empty }
  // 같은 카드에 여러 라운드가 붙였으면 한 번에 본다
  const byTask = new Map<string, RefineTarget>()
  for (const a of attached) {
    const cur = byTask.get(a.taskId)
    byTask.set(a.taskId, { taskId: a.taskId, sourceIds: [...(cur?.sourceIds ?? []), ...a.sourceIds], created: (cur?.created ?? false) || a.created })
  }
  const model = relevanceModel()
  console.log(`  이번에 글을 붙인 카드 ${byTask.size}개 · ${model}`)
  if (opts.dry || byTask.size === 0) return empty
  const cards = await loadCards(db, [...byTask.values()])
  const mask: MaskCount = { phone: 0, mail: 0 }
  const results = await runParallel(cards, 3, (c) => judgeCard(c, { model, mask }))
  const rep: RefineReport = { ...empty, cards: cards.length }
  for (const j of results) {
    if (!j.plan) { rep.failed++; console.log(`  ✗ ${j.card.title} — ${j.error} (카드는 그대로)`); continue }
    if (j.plan.judged) rep.judged++
    if (j.plan.allUnrelated) rep.allUnrelated++
    rep.unsure += j.plan.unsure.length
    try {
      await applyPlan(db, j, model)
    } catch (e) {
      rep.failed++
      console.log(`  ✗ ${j.card.title} 반영 실패 — ${(e as Error).message.slice(0, 160)}`)
      continue
    }
    rep.dropped += j.plan.drop.length
    for (const id of j.plan.drop) {
      const m = j.card.messages.find((x) => x.id === id)!
      rep.droppedList.push({ taskId: j.card.key, title: j.card.title, at: m.at, who: m.who, text: m.text.slice(0, 120) })
    }
    if (j.plan.rename) { rep.renamed++; rep.renames.push({ taskId: j.card.key, ...j.plan.rename }) }
  }
  console.log(`  판정 ${rep.judged} · 뗀 글 ${rep.dropped} · 애매로 붙여 둔 글 ${rep.unsure} · 제목 바꿈 ${rep.renamed} · 실패 ${rep.failed}${rep.allUnrelated ? ` · 전부 무관이라 그대로 둔 카드 ${rep.allUnrelated}` : ""} · 가린 전화번호 ${mask.phone} · 메일 ${mask.mail}`)
  for (const d of rep.droppedList) console.log(`    뗌 「${d.title}」 ${d.at} ${d.who}: ${d.text.replace(/\n/g, " ").slice(0, 60)}`)
  for (const r of rep.renames) console.log(`    제목 「${r.from}」 → 「${r.to}」 (${r.basis ?? "근거 없음"})`)
  return rep
}
