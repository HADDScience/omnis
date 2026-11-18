// 묶음 3(#248) 실행 — 지식 카드. 정의는 lib/tools/defs-cards.ts.
// 쓰기는 계획(WritePlan)을 세우고, run 은 화면 API 가 부르는 서버 함수(lib/omnis-cards · omnis-card-ops · card-proposals)를 그대로 부른다.
import { prisma } from "@/lib/db"
import type { Caller } from "@/lib/omnis-mcp"
import { deleteOmnisCard } from "@/lib/omnis-cards"
import { addBookmark, cardVersionContent, createOmnisCategory, deleteOmnisCategory, listBookmarks, removeBookmark, restoreOmnisCard } from "@/lib/omnis-card-ops"
import { acceptanceStats, applyProposal, rejectProposal, revertProposal } from "@/lib/card-proposals"
import { getHistory } from "@/lib/omnis-git"
import { migrateContent } from "@/lib/omnis-types"
import { sectionToText } from "@/lib/embeddings"
import { blocked, clip, kstDate, str, type Planner } from "./planned"
import type { CardReadName, CardWriteName } from "./defs-cards"

type CardRow = { id: string; title: string; category: { name: string } }

/** 카드 ID 또는 제목 일부 — 여럿이면 후보를 보여 주고 고르지 않는다 */
async function cardByRef(ref: string): Promise<CardRow | { error: string }> {
  const k = ref.trim()
  if (!k) return { error: "card 가 비어 있습니다 — list_omnis_cards 로 찾으세요." }
  const select = { id: true, title: true, category: { select: { name: true } } } as const
  const byId = await prisma.omnisCard.findUnique({ where: { id: k }, select }).catch(() => null)
  if (byId) return byId
  const hits = await prisma.omnisCard.findMany({ where: { title: { contains: k, mode: "insensitive" } }, select, orderBy: { updatedAt: "desc" }, take: 10 })
  const exact = hits.find((h) => h.title === k)
  if (exact || hits.length === 1) return exact ?? hits[0]
  if (hits.length === 0) return { error: `'${k}' 에 맞는 카드가 없습니다 — list_omnis_cards 로 찾으세요.` }
  return { error: [`'${k}' 에 맞는 카드가 ${hits.length}장입니다 — card 에 ID 를 주세요.`, ...hits.map((h) => `- [${h.category.name}] ${h.title} · id=${h.id}`)].join("\n") }
}

/** 카드 본문(JSON) → 사람이 읽는 글 */
function contentText(raw: unknown): string {
  try {
    return migrateContent(raw as never).sections.map((x) => sectionToText(x)).join("\n\n").trim()
  } catch {
    return typeof raw === "string" ? raw : JSON.stringify(raw)
  }
}

const PROPOSAL_STATUS: Record<string, string> = { PENDING: "대기", ACCEPTED: "수락", REJECTED: "거절", AUTO_APPLIED: "자동 적용" }

// ─── 읽기 ───

export async function runCardRead(name: CardReadName, args: Record<string, unknown>, caller: Caller): Promise<{ text: string } | { error: string }> {
  switch (name) {
    case "omnis_card_history": {
      const card = await cardByRef(str(args.card))
      if ("error" in card) return card
      const hash = str(args.hash)
      if (hash) {
        const v = cardVersionContent(card, hash)
        if (!v.ok) return { error: v.error }
        let parsed: unknown = v.value
        try { parsed = JSON.parse(v.value) } catch { /* 옛 버전은 글 그대로 */ }
        return { text: `# ${card.title} — 버전 ${hash.slice(0, 7)}\n\n${clip(contentText(parsed), 20_000)}` }
      }
      let history: ReturnType<typeof getHistory> = []
      try { history = getHistory(card.id, card.title) } catch { history = [] }
      if (history.length === 0) return { text: `「${card.title}」 버전 이력이 없습니다(이 서버에는 이력 저장소가 없거나 아직 고친 적이 없습니다).` }
      return { text: [`「${card.title}」 버전 ${history.length}개(최근 것부터) — 본문은 hash, 되돌리기는 restore_omnis_card`, ...history.map((h) => `- ${h.date.slice(0, 16)} · ${h.author} · ${h.message} · hash=${h.hash}`)].join("\n") }
    }
    case "list_card_proposals": {
      const st = str(args.status) || "PENDING"
      const where = st === "all" ? {} : st === "decided" ? { status: { in: ["ACCEPTED", "REJECTED", "AUTO_APPLIED"] as ("ACCEPTED" | "REJECTED" | "AUTO_APPLIED")[] } } : { status: "PENDING" as const }
      const [rows, stats] = await Promise.all([
        prisma.cardProposal.findMany({
          where, orderBy: { createdAt: "desc" }, take: 50,
          include: { card: { select: { title: true } }, category: { select: { name: true } }, triggerTask: { select: { slug: true } }, decidedBy: { select: { name: true } } },
        }),
        acceptanceStats(),
      ])
      const head = `수락률 ${stats.rate === null ? "-" : `${Math.round(stats.rate * 100)}%`} (판단 ${stats.decided} · 대기 ${stats.pending})${stats.auto ? " · 자동 적용 중" : ""}`
      if (rows.length === 0) return { text: `${head}\n제안이 없습니다.` }
      return {
        text: [
          head, `제안 ${rows.length}건 — 처리는 decide_card_proposal(proposal)`,
          ...rows.map((p) => [
            `- proposal=${p.id}`, PROPOSAL_STATUS[p.status] ?? p.status, kstDate(p.createdAt),
            p.card ? `고치기 「${p.card.title}」` : `새 카드 「${p.title}」${p.category ? ` [${p.category.name}]` : ""}`,
            clip(p.reason, 120), p.triggerTask ? `#${p.triggerTask.slug}` : null,
            p.revertedAt ? "되돌림" : null, p.decidedBy ? `판단 ${p.decidedBy.name}` : null,
          ].filter(Boolean).join(" · ")),
        ].join("\n"),
      }
    }
    case "list_bookmarks": {
      const rows = await listBookmarks(caller.userId)
      if (rows.length === 0) return { text: "즐겨찾기한 카드가 없습니다." }
      return { text: [`즐겨찾기 ${rows.length}장`, ...rows.map((b) => `- [${b.card.category.name}] ${b.card.title} · 조회 ${b.card._count.viewLogs} · card=${b.card.id}`)].join("\n") }
    }
    case "list_my_questions": {
      const take = Math.min(Math.max(Number(args.limit) || 10, 1), 30)
      const rows = await prisma.omnisQuery.findMany({ where: { userId: caller.userId }, orderBy: { createdAt: "desc" }, take })
      if (rows.length === 0) return { text: "물은 질문이 없습니다." }
      return { text: [`내 질문 ${rows.length}개(최근 것부터)`, ...rows.map((q) => `- ${kstDate(q.createdAt)} · Q: ${clip(q.question, 120)}\n  A: ${clip(q.answer.replace(/\s+/g, " "), 300)}`)].join("\n") }
    }
  }
}

// ─── 쓰기 계획 ───

const planDeleteCard: Planner = async (args, caller) => {
  const T = "지식 카드 지우기"
  const card = await cardByRef(str(args.card))
  if ("error" in card) return blocked(T, str(args.card) || "(카드 없음)", card.error)
  const full = await prisma.omnisCard.findUnique({ where: { id: card.id }, select: { content: true, _count: { select: { bookmarks: true } } } })
  return {
    title: T, target: `[${card.category.name}] ${card.title}`,
    changes: [{ label: "지울 카드", before: clip(contentText(full?.content).replace(/\s+/g, " "), 300) || "(본문 없음)", after: "지움" }],
    risk: `카드와 검색 색인이 지워집니다. 되돌릴 수 없습니다${full?._count.bookmarks ? ` — ${full._count.bookmarks}명의 즐겨찾기에서도 사라집니다` : ""}.`,
    confirmLabel: "지우기",
    run: async () => {
      await deleteOmnisCard(caller.userId, card.id)
      return { ok: true, id: card.id, text: `지웠습니다: ${card.title}` }
    },
  }
}

const planCategory: Planner = async (args, caller) => {
  const action = str(args.action)
  if (action === "create") {
    const name = str(args.name)
    if (!name) return blocked("지식 카드 분류 만들기", "", "name 이 비어 있습니다")
    const dup = await prisma.omnisCategory.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })
    return {
      title: "지식 카드 분류 만들기", target: name,
      changes: [{ label: "분류", before: null, after: `${str(args.icon) || "📁"} ${name}` }],
      risk: "지식 베이스 맨 뒤에 분류가 생깁니다.",
      ...(dup ? { warning: "같은 이름의 분류가 이미 있습니다 — 그래도 하나 더 만듭니다(화면과 같다)." } : {}),
      run: async () => {
        const r = await createOmnisCategory(caller.userId, { name, icon: str(args.icon) || null })
        return r.ok ? { ok: true, id: r.value.id, text: `만들었습니다: ${r.value.icon} ${r.value.name} · id=${r.value.id}` } : { ok: false, error: r.error }
      },
    }
  }
  if (action !== "delete") return blocked("지식 카드 분류", "", "action 은 create · delete 중 하나입니다")
  const ref = str(args.category)
  const cat = ref ? await prisma.omnisCategory.findFirst({ where: { OR: [{ id: ref }, { name: ref }] }, include: { _count: { select: { cards: true } } } }) : null
  if (!cat) return blocked("지식 카드 분류 지우기", ref || "(분류 없음)", "분류를 찾지 못했습니다 — 분류 ID 나 정확한 이름을 주세요(list_omnis_cards 에 [분류] 로 보인다)")
  return {
    title: "지식 카드 분류 지우기", target: `${cat.icon} ${cat.name}`,
    changes: [{ label: "분류", before: `${cat.name} · 카드 ${cat._count.cards}장`, after: "지움" }],
    risk: "빈 분류만 지울 수 있습니다.",
    confirmLabel: "지우기",
    ...(cat._count.cards > 0 ? { problem: "카드가 있는 분류는 지울 수 없습니다 — 카드를 다른 분류로 옮기거나 지운 뒤에 지웁니다" } : {}),
    run: async () => {
      const r = await deleteOmnisCategory(caller.userId, cat.id)
      return r.ok ? { ok: true, id: cat.id, text: `지웠습니다: ${r.value.name}` } : { ok: false, error: r.error }
    },
  }
}

const planRestore: Planner = async (args, caller) => {
  const T = "지식 카드 되돌리기"
  const card = await cardByRef(str(args.card))
  if ("error" in card) return blocked(T, str(args.card) || "(카드 없음)", card.error)
  const hash = str(args.hash)
  if (!hash) return blocked(T, card.title, "hash 가 비어 있습니다 — omnis_card_history 로 버전을 고르세요")
  const v = cardVersionContent(card, hash)
  if (!v.ok) return blocked(T, card.title, v.error)
  let parsed: unknown
  try { parsed = JSON.parse(v.value) } catch { return blocked(T, card.title, "이 버전의 내용이 JSON 형식이 아니어서 복원할 수 없습니다") }
  const now = await prisma.omnisCard.findUnique({ where: { id: card.id }, select: { content: true, version: true } })
  return {
    title: T, target: `${card.title} → 버전 ${hash.slice(0, 7)}`,
    changes: [{ label: "본문", before: clip(contentText(now?.content).replace(/\s+/g, " "), 400), after: clip(contentText(parsed).replace(/\s+/g, " "), 400) }],
    risk: `카드가 그 버전 내용으로 바뀌고 새 버전(${(now?.version ?? 0) + 1})으로 쌓입니다. 지금 내용은 이력에 남아 다시 되돌릴 수 있습니다.`,
    run: async () => {
      const r = await restoreOmnisCard({ id: caller.userId, name: caller.name }, card.id, hash)
      return r.ok ? { ok: true, id: card.id, text: `되돌렸습니다: ${r.value.title} · 버전 ${r.value.version}` } : { ok: false, error: r.error }
    },
  }
}

const planProposal: Planner = async (args, caller) => {
  const action = str(args.action)
  const ACTION: Record<string, string> = { accept: "수락(카드에 반영)", reject: "거절", revert: "되돌리기(반영 취소)" }
  const T = `카드 제안 ${ACTION[action] ?? ""}`.trim()
  if (!ACTION[action]) return blocked("카드 제안", "", "action 은 accept · reject · revert 중 하나입니다")
  const p = str(args.proposal) ? await prisma.cardProposal.findUnique({ where: { id: str(args.proposal) }, include: { card: { select: { title: true, content: true } }, category: { select: { name: true } } } }) : null
  if (!p) return blocked(T, str(args.proposal) || "(제안 없음)", "제안을 찾지 못했습니다 — list_card_proposals 의 proposal 을 넣으세요")
  const target = p.card ? `「${p.card.title}」 고치기` : `새 카드 「${p.title}」${p.category ? ` [${p.category.name}]` : ""}`
  const changes = action === "accept"
    ? [{ label: "카드 본문", before: p.card ? clip(contentText(p.card.content).replace(/\s+/g, " "), 400) : null, after: clip(contentText(p.content).replace(/\s+/g, " "), 400) }]
    : [{ label: "제안", before: PROPOSAL_STATUS[p.status] ?? p.status, after: action === "reject" ? "거절" : "되돌림" }]
  return {
    title: T, target, changes,
    risk: action === "accept" ? "카드가 제안 내용으로 바뀌고(새 카드면 생기고) 수락률에 반영됩니다." : action === "revert" ? "반영된 내용을 원래대로 되돌리고 수락률에는 거절로 셉니다." : "제안을 닫고 수락률에 거절로 셉니다.",
    ...(action !== "revert" && p.status !== "PENDING" ? { problem: `이미 판단한 제안입니다(${PROPOSAL_STATUS[p.status]})` } : {}),
    run: async () => {
      const r = action === "accept" ? await applyProposal(p.id, { userId: caller.userId }) : action === "reject" ? await rejectProposal(p.id, caller.userId) : await revertProposal(p.id, caller.userId)
      return "error" in r ? { ok: false, error: r.error } : { ok: true, id: p.id, text: `${ACTION[action]} 했습니다.` }
    },
  }
}

const planBookmark: Planner = async (args, caller) => {
  const action = str(args.action)
  if (action !== "add" && action !== "remove") return blocked("즐겨찾기", "", "action 은 add · remove 중 하나입니다")
  const T = action === "add" ? "즐겨찾기 더하기" : "즐겨찾기 빼기"
  const card = await cardByRef(str(args.card))
  if ("error" in card) return blocked(T, str(args.card) || "(카드 없음)", card.error)
  const has = await prisma.bookmark.findUnique({ where: { userId_cardId: { userId: caller.userId, cardId: card.id } }, select: { id: true } })
  return {
    title: T, target: `[${card.category.name}] ${card.title}`,
    changes: [{ label: "내 즐겨찾기", before: has ? "있음" : "없음", after: action === "add" ? "있음" : "없음" }],
    risk: "내 즐겨찾기 목록만 바뀝니다.",
    ...(action === "add" && has ? { problem: "이미 즐겨찾기한 카드입니다" } : action === "remove" && !has ? { problem: "즐겨찾기에 없는 카드입니다" } : {}),
    run: async () => {
      const r = action === "add" ? await addBookmark(caller.userId, card.id) : await removeBookmark(caller.userId, card.id)
      return r.ok ? { ok: true, id: card.id, text: action === "add" ? "더했습니다." : "뺐습니다." } : { ok: false, error: r.error }
    },
  }
}

export const CARD_PLANNERS: Record<CardWriteName, Planner> = {
  delete_omnis_card: planDeleteCard,
  manage_omnis_category: planCategory,
  restore_omnis_card: planRestore,
  decide_card_proposal: planProposal,
  manage_bookmarks: planBookmark,
}
