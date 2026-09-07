import { Prisma, type WebsitePost } from "@/generated/prisma"
import { prisma } from "@/lib/db"
import type { Lang, PostInput, PostLocale, WebsitePostDto } from "@/lib/schemas/website"
import { deletePostMedia } from "@/lib/website-media"
import { fillTranslations } from "@/lib/website-translate"

/**
 * 홈페이지 기사 저장 계층. API 라우트는 얇게 두고 일은 여기서 한다 — 이식 스크립트와
 * 나중에 붙을 MCP 도구가 같은 길을 쓰기 위해서다(lib/chat-post.ts 와 같은 방침).
 */

export function toDto(row: WebsitePost): WebsitePostDto {
  return {
    id: row.id,
    position: row.position,
    date: row.date,
    sourceLang: row.sourceLang as Lang,
    thumbnail: row.thumbnail,
    externalHref: row.externalHref,
    content: row.content as Partial<Record<Lang, PostLocale>>,
    deck: (row.deck as WebsitePostDto["deck"]) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listPosts(): Promise<WebsitePostDto[]> {
  const rows = await prisma.websitePost.findMany({ orderBy: [{ position: "asc" }, { id: "desc" }] })
  return rows.map(toDto)
}

export async function getPost(id: string): Promise<WebsitePostDto | null> {
  const row = await prisma.websitePost.findUnique({ where: { id } })
  return row ? toDto(row) : null
}

/**
 * 저장(upsert). 새 글은 맨 앞(position 0)에 들어가고 나머지는 한 칸씩 밀린다.
 * 번역은 저장 안에서 돈다 — 실패해도 원문은 저장되고, 실패 목록만 응답에 실린다.
 */
export async function savePost(
  id: string,
  input: PostInput,
  userId: string
): Promise<{ post: WebsitePostDto; translationFailures: string[] }> {
  const { content, failures } = await fillTranslations(input.content, input.sourceLang, userId)
  const data = {
    date: input.date,
    sourceLang: input.sourceLang,
    thumbnail: input.thumbnail,
    externalHref: input.externalHref,
    content: content as Prisma.InputJsonValue,
    deck: input.deck === null || input.deck === undefined ? Prisma.JsonNull : (input.deck as Prisma.InputJsonValue),
    updatedById: userId,
  }

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.websitePost.findUnique({ where: { id }, select: { id: true } })
    if (existing) return tx.websitePost.update({ where: { id }, data })
    await tx.websitePost.updateMany({ data: { position: { increment: 1 } } })
    return tx.websitePost.create({ data: { id, position: 0, ...data } })
  })
  return { post: toDto(row), translationFailures: failures }
}

export async function deletePost(id: string): Promise<boolean> {
  const existing = await prisma.websitePost.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return false
  // NAS 를 먼저 지운다. 행이 먼저 사라지면 어떤 파일이 있었는지 알 길이 없다.
  await deletePostMedia(id)
  await prisma.websitePost.delete({ where: { id } })
  return true
}

/** id 배열 순서대로 position 을 다시 매긴다. 배열에 없는 글은 그 뒤에 기존 순서대로 붙는다. */
export async function reorderPosts(order: string[]): Promise<void> {
  const all = await prisma.websitePost.findMany({ select: { id: true }, orderBy: { position: "asc" } })
  const known = new Set(all.map((p) => p.id))
  const head = order.filter((id) => known.has(id))
  const tail = all.map((p) => p.id).filter((id) => !head.includes(id))
  const final = [...head, ...tail]
  await prisma.$transaction(
    final.map((id, position) => prisma.websitePost.update({ where: { id }, data: { position } }))
  )
}

/**
 * 사이트에 "기사가 바뀌었다"고 알린다. 사이트는 60초 ISR 로도 따라오므로 실패는 로그만 남긴다.
 */
export async function revalidateWebsite(): Promise<void> {
  const origin = process.env.WEBSITE_ORIGIN
  const secret = process.env.WEBSITE_REVALIDATE_SECRET
  if (!origin || !secret) return
  try {
    const res = await fetch(`${origin}/api/revalidate/`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    })
    if (!res.ok) console.warn("[website] 재검증 실패", res.status)
  } catch (err) {
    console.warn("[website] 재검증 호출 실패", err)
  }
}
