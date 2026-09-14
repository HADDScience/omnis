// 지식 카드 갱신 제안 — AI 가 올리고, 사람이 수락·거절하고, 수락이 꾸준하면 자동으로 넘어간다.
//
// 왜 이런 구조인가. 카드를 사람이 직접 쓰는 방식으로는 한 번도 채워지지 않았다
// (프로덕션 카드 0장 · 조회 0 · 만들어진 카드는 「배포 검증용」 하나뿐).
// 그래서 AI 가 업무에서 생긴 변화를 제안으로 올린다. 다만 지식은 RAG 에 실려 오래 남으므로
// 처음부터 자동으로 쓰게 두지 않는다 — 사람이 수락한 기록이 쌓이면 그때 자동으로 넘긴다.
//
// 배경·설계: mydocs/plans/2026-09-10-ai-maintained-cards.md
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { detectKnowledge, draftCardUpdate, type KnowledgeTopic } from "@/lib/ai"
import { retrieveHybrid, syncEmbeddingsSafe, sectionToText } from "@/lib/embeddings"
import { migrateContent } from "@/lib/omnis-types"
import { initCardFile, saveAndCommit } from "@/lib/omnis-git"
import { writeActivity } from "@/lib/api"

// ─── 자동 적용 기준 ─────────────────────────────────────────────
//
// 사람이 판단한 것만 센다. 자동 적용된 것은 세지 않는다 — 그것까지 성공으로 세면
// 한번 켜진 자동 모드가 스스로를 정당화해 영영 꺼지지 않는다.
// 다만 자동 적용된 것을 사람이 되돌리면 거절로 센다. 그래야 틀리기 시작했을 때 스스로 꺼진다.

/** 이만큼 판단이 쌓이기 전에는 자동으로 넘기지 않는다 */
export const AUTO_APPLY_MIN_DECIDED = Number(process.env.CARD_AUTO_MIN_DECIDED ?? 20)
/** 최근 이만큼만 보고 센다. 옛날에 잘했다고 지금도 잘하는 것은 아니다 */
export const AUTO_APPLY_WINDOW = Number(process.env.CARD_AUTO_WINDOW ?? 50)
/** 이 수락률을 넘으면 자동으로 적용한다 */
export const AUTO_APPLY_MIN_RATE = Number(process.env.CARD_AUTO_MIN_RATE ?? 0.8)

export interface AcceptanceStats {
  /** 사람이 판단한 건수 (수락 + 거절 + 되돌림) */
  decided: number
  accepted: number
  rejected: number
  /** 0~1. 판단이 없으면 null */
  rate: number | null
  /** 지금 자동 적용 상태인가 */
  auto: boolean
  /** 자동으로 넘어가려면 몇 건이 더 필요한가 */
  needMore: number
  pending: number
  autoApplied: number
  thresholds: { minDecided: number; window: number; minRate: number }
}

/**
 * 최근 판단으로 수락률을 센다.
 *
 * 되돌린 자동 적용(`revertedAt != null`)은 거절로 센다.
 * 손대지 않은 자동 적용은 표본에 넣지 않는다.
 */
export async function acceptanceStats(): Promise<AcceptanceStats> {
  const decidedRows = await prisma.cardProposal.findMany({
    where: {
      OR: [
        { status: { in: ["ACCEPTED", "REJECTED"] } },
        { status: "AUTO_APPLIED", revertedAt: { not: null } },
      ],
    },
    orderBy: { decidedAt: "desc" },
    take: AUTO_APPLY_WINDOW,
    select: { status: true, revertedAt: true },
  })

  const accepted = decidedRows.filter((r) => r.status === "ACCEPTED" && !r.revertedAt).length
  const rejected = decidedRows.length - accepted
  const decided = decidedRows.length
  const rate = decided > 0 ? accepted / decided : null
  const auto = decided >= AUTO_APPLY_MIN_DECIDED && rate !== null && rate >= AUTO_APPLY_MIN_RATE

  const [pending, autoApplied] = await Promise.all([
    prisma.cardProposal.count({ where: { status: "PENDING" } }),
    prisma.cardProposal.count({ where: { status: "AUTO_APPLIED" } }),
  ])

  return {
    decided,
    accepted,
    rejected,
    rate,
    auto,
    needMore: Math.max(AUTO_APPLY_MIN_DECIDED - decided, 0),
    pending,
    autoApplied,
    thresholds: { minDecided: AUTO_APPLY_MIN_DECIDED, window: AUTO_APPLY_WINDOW, minRate: AUTO_APPLY_MIN_RATE },
  }
}

/** 지금 제안을 사람 확인 없이 반영해도 되나 */
export async function shouldAutoApply(): Promise<boolean> {
  if (process.env.CARD_AUTO_APPLY === "off") return false
  if (process.env.CARD_AUTO_APPLY === "on") return true
  return (await acceptanceStats()).auto
}

// ─── 제안 만들기 ───────────────────────────────────────────────

export interface SourceRef {
  kind: "task" | "message"
  id: string
  label: string
}

const MAX_PENDING = Number(process.env.CARD_MAX_PENDING ?? 30)

/**
 * 업무 하나가 끝났을 때 그 대화에서 지식을 뽑아 제안을 만든다.
 *
 * 실패는 삼킨다 — 카드 제안 때문에 업무 완료가 막히면 안 된다. 호출부는 `void` 로 부른다.
 * 트리거: 업무가 DONE 이 되는 두 곳 (알림 confirm_done · 업무 PATCH).
 */
export async function proposeFromTask(
  taskId: string,
  opts: { trigger?: string; userId?: string } = {}
): Promise<{ created: number; skipped?: string }> {
  const trigger = opts.trigger ?? "task_done"

  // 쌓인 제안이 너무 많으면 멈춘다. 아무도 안 보는 목록을 더 늘려 봐야 소용없다.
  const pending = await prisma.cardProposal.count({ where: { status: "PENDING" } })
  if (pending >= MAX_PENDING) return { created: 0, skipped: `미처리 제안 ${pending}건` }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      name: true,
      messages: {
        select: { id: true, content: true, createdAt: true, author: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 200,
      },
    },
  })
  if (!task || task.messages.length === 0) return { created: 0, skipped: "대화 없음" }

  // 이미 이 업무로 제안을 만들었으면 다시 만들지 않는다 (업무는 여러 번 DONE 이 될 수 있다)
  const already = await prisma.cardProposal.count({ where: { triggerTaskId: taskId } })
  if (already > 0) return { created: 0, skipped: "이미 처리한 업무" }

  const messages = task.messages.map((m) => ({ author: m.author?.name ?? "?", content: m.content }))
  const topics = await detectKnowledge(task.name, messages, opts.userId)
  if (topics.length === 0) return { created: 0, skipped: "남길 지식 없음" }

  const evidence = task.messages
    .map((m) => `[${m.createdAt.toISOString().slice(0, 10)}] ${m.author?.name ?? "?"}: ${m.content}`)
    .join("\n")
  const sourceRefs: SourceRef[] = [{ kind: "task", id: task.id, label: task.name }]

  let created = 0
  for (const topic of topics) {
    const ok = await proposeOne(topic, evidence, sourceRefs, { trigger, triggerTaskId: task.id, userId: opts.userId })
    if (ok) created++
  }
  return { created }
}

/** 주제 하나를 제안으로 만든다. 자동 적용 상태면 바로 반영한다 */
export async function proposeOne(
  topic: KnowledgeTopic,
  evidence: string,
  sourceRefs: SourceRef[],
  opts: { trigger: string; triggerTaskId?: string; userId?: string }
): Promise<boolean> {
  if (sourceRefs.length === 0) return false // 근거 없이는 만들지 않는다

  const target = await findTargetCard(topic)
  const existing = target
    ? {
        title: target.title,
        body: migrateContent(target.content)
          .sections.map((s) => `### ${s.title}\n${sectionToText(s)}`)
          .join("\n\n"),
        humanEdited: target.humanEdited,
      }
    : null

  const draft = await draftCardUpdate(topic, existing, evidence, opts.userId)
  if (!draft) return false

  const content = {
    sections: draft.sections.map((s) => ({ id: crypto.randomUUID(), type: "text", title: s.title, body: s.body })),
  }

  const proposal = await prisma.cardProposal.create({
    data: {
      cardId: target?.id ?? null,
      categoryId: target ? null : await defaultCategoryId(),
      title: draft.title,
      content: content as unknown as Prisma.InputJsonValue,
      reason: draft.reason,
      sourceRefs: sourceRefs as unknown as Prisma.InputJsonValue,
      trigger: opts.trigger,
      triggerTaskId: opts.triggerTaskId ?? null,
    },
  })

  // 같은 카드에 이전 제안이 떠 있으면 밀어낸다 — 사람이 낡은 것을 수락하지 않게.
  if (target) {
    await prisma.cardProposal.updateMany({
      where: { cardId: target.id, status: "PENDING", id: { not: proposal.id } },
      data: { status: "SUPERSEDED" },
    })
  }

  if (await shouldAutoApply()) {
    await applyProposal(proposal.id, { userId: opts.userId, auto: true })
  }
  return true
}

/** 주제에 붙을 카드를 찾는다. 비슷한 카드가 없으면 null (새 카드 제안) */
async function findTargetCard(topic: KnowledgeTopic) {
  const { chunks } = await retrieveHybrid(`${topic.title} ${topic.summary}`, {
    limit: 5,
    sources: ["OMNIS_CARD"],
  })
  const best = chunks.find((c) => c.similarity >= 0.55)
  if (!best) return null

  const card = await prisma.omnisCard.findUnique({
    where: { id: best.sourceId },
    select: { id: true, title: true, content: true, versions: { select: { authorKind: true } } },
  })
  if (!card) return null
  return { ...card, humanEdited: card.versions.some((v) => v.authorKind === "HUMAN") }
}

async function defaultCategoryId(): Promise<string | null> {
  const cat =
    (await prisma.omnisCategory.findFirst({ where: { name: "기업정보" }, select: { id: true } })) ??
    (await prisma.omnisCategory.findFirst({ orderBy: { sortOrder: "asc" }, select: { id: true } }))
  return cat?.id ?? null
}

// ─── 판단 ───────────────────────────────────────────────────────

/** 제안을 카드에 반영한다. `auto` 면 사람 판단 없이 반영한 것으로 기록한다 */
export async function applyProposal(
  proposalId: string,
  opts: { userId?: string; auto?: boolean } = {}
): Promise<{ cardId: string } | { error: string }> {
  const p = await prisma.cardProposal.findUnique({ where: { id: proposalId } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if (p.status !== "PENDING") return { error: `이미 처리된 제안입니다 (${p.status})` }

  const content = p.content as Prisma.InputJsonValue
  const authorKind = "AI" as const

  const cardId = await prisma.$transaction(async (tx) => {
    let id: string
    let version: number
    if (p.cardId) {
      const cur = await tx.omnisCard.findUnique({ where: { id: p.cardId }, select: { version: true } })
      if (!cur) throw new Error("카드가 사라졌습니다")
      version = cur.version + 1
      await tx.omnisCard.update({
        where: { id: p.cardId },
        data: {
          title: p.title,
          content,
          version,
          updatedById: opts.userId ?? null,
          sourceRefs: p.sourceRefs as Prisma.InputJsonValue,
          aiUpdatedAt: new Date(),
        },
      })
      id = p.cardId
    } else {
      if (!p.categoryId) throw new Error("분류가 없습니다")
      const createdCard = await tx.omnisCard.create({
        data: {
          categoryId: p.categoryId,
          title: p.title,
          content,
          tags: [],
          updatedById: opts.userId ?? null,
          sourceRefs: p.sourceRefs as Prisma.InputJsonValue,
          aiUpdatedAt: new Date(),
        },
      })
      id = createdCard.id
      version = createdCard.version
    }

    await tx.omnisCardVersion.create({
      data: { cardId: id, content, version, createdById: opts.userId ?? null, authorKind },
    })
    await tx.cardProposal.update({
      where: { id: proposalId },
      data: {
        status: opts.auto ? "AUTO_APPLIED" : "ACCEPTED",
        decidedById: opts.auto ? null : (opts.userId ?? null),
        decidedAt: new Date(),
        cardId: id,
      },
    })
    return id
  })

  // 색인·파일은 트랜잭션 밖에서 (실패해도 카드는 남는다)
  const body = JSON.stringify(p.content, null, 2)
  try {
    if (p.cardId) saveAndCommit(cardId, p.title, body, opts.auto ? "Omnis AI (자동)" : "Omnis AI")
    else initCardFile(cardId, p.title, body)
  } catch (err) {
    console.error("[card-proposals] git 기록 실패", { cardId, err })
  }
  await syncEmbeddingsSafe("OMNIS_CARD", cardId, opts.userId)
  await writeActivity({
    userId: opts.userId,
    action: p.cardId ? "omnis.updated" : "omnis.created",
    entity: "OMNIS_CARD",
    entityId: cardId,
    title: `${opts.auto ? "AI 자동 반영" : "AI 제안 수락"}: ${p.title}`,
  })
  return { cardId }
}

export async function rejectProposal(proposalId: string, userId?: string): Promise<{ ok: true } | { error: string }> {
  const p = await prisma.cardProposal.findUnique({ where: { id: proposalId }, select: { status: true } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if (p.status !== "PENDING") return { error: `이미 처리된 제안입니다 (${p.status})` }
  await prisma.cardProposal.update({
    where: { id: proposalId },
    data: { status: "REJECTED", decidedById: userId ?? null, decidedAt: new Date() },
  })
  return { ok: true }
}

/**
 * 자동 반영된 것을 되돌린다. 카드를 직전 판으로 돌리고, 수락률에 거절로 반영한다.
 * 이게 자동 모드를 스스로 끄는 장치다.
 */
export async function revertProposal(proposalId: string, userId?: string): Promise<{ ok: true } | { error: string }> {
  const p = await prisma.cardProposal.findUnique({ where: { id: proposalId } })
  if (!p) return { error: "제안을 찾지 못했습니다" }
  if (p.status !== "AUTO_APPLIED" && p.status !== "ACCEPTED") return { error: "되돌릴 수 있는 제안이 아닙니다" }
  if (p.revertedAt) return { error: "이미 되돌렸습니다" }
  if (!p.cardId) return { error: "대상 카드가 없습니다" }

  const versions = await prisma.omnisCardVersion.findMany({
    where: { cardId: p.cardId },
    orderBy: { version: "desc" },
    take: 2,
  })
  const prev = versions[1]

  await prisma.$transaction(async (tx) => {
    if (prev) {
      const cur = await tx.omnisCard.findUnique({ where: { id: p.cardId! }, select: { version: true } })
      const nextVersion = (cur?.version ?? prev.version) + 1
      await tx.omnisCard.update({
        where: { id: p.cardId! },
        data: { content: prev.content as Prisma.InputJsonValue, version: nextVersion, updatedById: userId ?? null },
      })
      await tx.omnisCardVersion.create({
        data: {
          cardId: p.cardId!,
          content: prev.content as Prisma.InputJsonValue,
          version: nextVersion,
          createdById: userId ?? null,
          authorKind: "HUMAN",
        },
      })
    } else {
      // 이 제안이 만든 첫 판이면 카드를 지운다. 제안을 먼저 떼어 둔다 —
      // 관계가 SetNull 이라 기록은 남지만, 순서를 뒤집으면 지워진 행을 고치려 들어 실패한다.
      await tx.cardProposal.update({ where: { id: proposalId }, data: { cardId: null } })
      await tx.omnisCard.delete({ where: { id: p.cardId! } })
    }
    await tx.cardProposal.update({
      where: { id: proposalId },
      data: { revertedAt: new Date(), decidedById: userId ?? null, decidedAt: new Date() },
    })
  })

  if (prev) await syncEmbeddingsSafe("OMNIS_CARD", p.cardId, userId)
  await writeActivity({
    userId,
    action: "omnis.updated",
    entity: "OMNIS_CARD",
    entityId: p.cardId,
    title: `AI 반영 되돌림: ${p.title}`,
  })
  return { ok: true }
}

/** 업무 완료 트리거 — 호출부에서 `void` 로 부른다. 여기서 절대 던지지 않는다 */
export function proposeFromTaskSafe(taskId: string, opts: { trigger?: string; userId?: string } = {}): void {
  void proposeFromTask(taskId, opts)
    .then((r) => {
      if (r.created > 0) console.log(`[card-proposals] 업무 ${taskId} → 제안 ${r.created}건`)
    })
    .catch((err) => console.error("[card-proposals] 제안 실패", { taskId, err }))
}
