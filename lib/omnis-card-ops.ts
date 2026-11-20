// 지식 카드 분류 · 복원 · 즐겨찾기 — 화면(app/api/omnis · omnis/cards/history · omnis/[cardId]/restore · bookmarks)과
// 도구(lib/tools/plan-cards.ts)가 같이 부른다. 라우트 안에 있던 것을 그대로 옮겼다(#248).
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { getVersionContent, saveAndCommit } from "@/lib/omnis-git"
import type { Prisma } from "@/generated/prisma/client"

export type CardOpResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string }
const fail = (status: number, error: string) => ({ ok: false as const, status, error })

/** 분류 만들기 — 맨 뒤에 붙는다 */
export async function createOmnisCategory(userId: string, input: { name: string; icon?: string | null }): Promise<CardOpResult<Prisma.OmnisCategoryGetPayload<object>>> {
  const name = input.name.trim()
  if (!name) return fail(400, "name 필수")
  const maxSort = await prisma.omnisCategory.aggregate({ _max: { sortOrder: true } })
  const category = await prisma.omnisCategory.create({
    data: { name, icon: input.icon || "📁", sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
  })
  await writeActivity({ userId, action: "omnis_category.created", entity: "OMNIS_CATEGORY", entityId: category.id, title: `카테고리 생성: ${category.name}` })
  return { ok: true, value: category }
}

/** 빈 분류만 지운다 — 카드가 있으면 거절 */
export async function deleteOmnisCategory(userId: string, id: string): Promise<CardOpResult<{ name: string }>> {
  const exists = await prisma.omnisCategory.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return fail(404, "카테고리 없음")
  const cardCount = await prisma.omnisCard.count({ where: { categoryId: id } })
  if (cardCount > 0) return fail(400, "카드가 있는 카테고리는 삭제할 수 없습니다")
  const category = await prisma.omnisCategory.delete({ where: { id } })
  await writeActivity({ userId, action: "omnis_category.deleted", entity: "OMNIS_CATEGORY", entityId: id, title: `카테고리 삭제: ${category.name}` })
  return { ok: true, value: { name: category.name } }
}

/** 버전 하나의 내용(JSON 글). 해시가 틀리면 400, 없으면 404 */
export function cardVersionContent(card: { id: string; title: string }, hash: string): CardOpResult<string> {
  let content = ""
  try {
    content = getVersionContent(card.id, card.title, hash)
  } catch (err) {
    console.error("[omnis-card-ops] 버전 조회 실패", { cardId: card.id, hash, err })
    return fail(400, "잘못된 버전 해시입니다")
  }
  if (!content) return fail(404, "버전 내용을 찾을 수 없습니다")
  return { ok: true, value: content }
}

/** 카드를 옛 버전으로 되돌린다 — 새 버전으로 쌓이고(이력은 지우지 않는다) 색인 · 활동 기록이 따라온다 */
export async function restoreOmnisCard(user: { id: string; name?: string | null }, cardId: string, hash: string): Promise<CardOpResult<{ content: Prisma.InputJsonValue; version: number; title: string }>> {
  const card = await prisma.omnisCard.findUnique({ where: { id: cardId }, select: { id: true, title: true } })
  if (!card) return fail(404, "카드 없음")
  const v = cardVersionContent(card, hash)
  if (!v.ok) return { ...v, error: v.status === 404 ? "복원할 버전 내용을 찾을 수 없습니다" : v.error }
  let restoredJson: Prisma.InputJsonValue
  try {
    restoredJson = JSON.parse(v.value) as Prisma.InputJsonValue
  } catch (err) {
    console.error("[omnis-card-ops] 복원 JSON 파싱 실패", { cardId, hash, err })
    return fail(422, "이 버전의 내용이 JSON 형식이 아니어서 복원할 수 없습니다")
  }
  const restored = await prisma.$transaction(async (tx) => {
    const updated = await tx.omnisCard.update({ where: { id: cardId }, data: { content: restoredJson, version: { increment: 1 }, updatedById: user.id } })
    await tx.omnisCardVersion.create({ data: { cardId, content: restoredJson, version: updated.version, restoredFromHash: hash, createdById: user.id } })
    return updated
  })
  saveAndCommit(card.id, card.title, v.value, user.name ?? "unknown", `${card.title} 롤백 (${hash.slice(0, 7)})`)
  await syncEmbeddingsSafe("OMNIS_CARD", cardId, user.id)
  await writeActivity({ userId: user.id, action: "omnis.restored", entity: "OMNIS_CARD", entityId: cardId, title: `카드 복원: ${card.title}`, metadata: { hash } })
  return { ok: true, value: { content: restoredJson, version: restored.version, title: card.title } }
}

/** 내 즐겨찾기 */
export function listBookmarks(userId: string) {
  return prisma.bookmark.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      card: {
        include: {
          category: { select: { name: true, icon: true } },
          updatedBy: { select: { name: true } },
          _count: { select: { viewLogs: true } },
        },
      },
    },
  })
}

export async function addBookmark(userId: string, cardId: string): Promise<CardOpResult<Prisma.BookmarkGetPayload<object>>> {
  const card = await prisma.omnisCard.findUnique({ where: { id: cardId }, select: { id: true, title: true } })
  if (!card) return fail(404, "카드 없음")
  const bookmark = await prisma.bookmark.upsert({ where: { userId_cardId: { userId, cardId } }, update: {}, create: { userId, cardId } })
  await writeActivity({ userId, action: "bookmark.created", entity: "OMNIS_CARD", entityId: card.id, title: `즐겨찾기 추가: ${card.title}` })
  return { ok: true, value: bookmark }
}

/** 즐겨찾기 빼기 — 즐겨찾기 ID 또는 카드 ID. 내 것만 */
export async function removeBookmark(userId: string, idOrCardId: string): Promise<CardOpResult<{ title: string }>> {
  const bookmark = await prisma.bookmark.findFirst({
    where: { userId, OR: [{ id: idOrCardId }, { cardId: idOrCardId }] },
    include: { card: { select: { id: true, title: true } } },
  })
  if (!bookmark) return fail(404, "즐겨찾기 없음")
  await prisma.bookmark.delete({ where: { id: bookmark.id } })
  await writeActivity({ userId, action: "bookmark.deleted", entity: "OMNIS_CARD", entityId: bookmark.card.id, title: `즐겨찾기 제거: ${bookmark.card.title}` })
  return { ok: true, value: { title: bookmark.card.title } }
}
