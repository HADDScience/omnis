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
    category: (row.category === "library" ? "library" : "news") as WebsitePostDto["category"],
    position: row.position,
    pinned: row.pinned,
    date: row.date,
    sourceLang: row.sourceLang as Lang,
    thumbnail: row.thumbnail,
    externalHref: row.externalHref,
    content: row.content as Partial<Record<Lang, PostLocale>>,
    deck: (row.deck as WebsitePostDto["deck"]) ?? null,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * 목록 순서. 고정한 글이 먼저고, 그 안에서는 원래 `position` 순서다.
 *
 * 고정을 순서 이동으로 흉내 내지 않는 이유: `position` 을 옮기면 고정을 풀었을 때
 * 원래 자리를 알 수 없다. 덧씌우기로 두면 풀자마자 제자리로 돌아간다.
 * 사이트는 받은 순서를 그대로 그리므로 정렬은 여기 한 곳에만 있다.
 */
export async function listPosts(): Promise<WebsitePostDto[]> {
  const rows = await prisma.websitePost.findMany({
    orderBy: [{ pinned: "desc" }, { position: "asc" }, { id: "desc" }],
  })
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
    // 안 보내면 원래 고정 상태를 지킨다. 고정은 /posts/<id>/pin 이 따로 맡는다.
    ...(input.pinned === undefined ? {} : { pinned: input.pinned }),
  }

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.websitePost.findUnique({ where: { id }, select: { id: true, category: true } })
    // 분류를 안 보내면 원래 것을 지킨다. 새 글은 뉴스다.
    const category = input.category ?? existing?.category ?? "news"
    if (existing) {
      if (category === existing.category) return tx.websitePost.update({ where: { id }, data: { ...data, category } })
      // 목록을 옮기는 저장: 새 목록의 맨 앞으로 넣고 그 목록을 한 칸씩 민다.
      await tx.websitePost.updateMany({ where: { category }, data: { position: { increment: 1 } } })
      return tx.websitePost.update({ where: { id }, data: { ...data, category, position: 0 } })
    }
    // position 은 목록별로 센다. 라이브러리 글 하나를 저장했다고 뉴스가 한 칸씩 밀리면
    // 두 목록의 순서가 서로 흔들린다.
    await tx.websitePost.updateMany({
      where: { category },
      data: { position: { increment: 1 } },
    })
    return tx.websitePost.create({ data: { id, position: 0, category, ...data } })
  })
  return { post: toDto(row), translationFailures: failures }
}

/**
 * 고정을 켜고 끈다. 없는 글이면 null.
 *
 * 기사 전체를 PUT 하지 않는 이유: 본문·덱을 다시 쓰고 번역 검사까지 돌아간다.
 * 압정 한 번 누르는 데 치를 값이 아니고, 그 사이 다른 사람이 고친 본문을 덮을 수도 있다.
 * 개수 제한은 두지 않는다 — 작업지시자가 뉴스·라이브러리 각각 제한 없이 가자고 했다.
 */
export async function setPinned(id: string, pinned: boolean, userId: string): Promise<boolean | null> {
  const existing = await prisma.websitePost.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return null
  const row = await prisma.websitePost.update({
    where: { id },
    data: { pinned, updatedById: userId },
    select: { pinned: true },
  })
  return row.pinned
}

export async function deletePost(id: string): Promise<boolean> {
  const existing = await prisma.websitePost.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return false
  // NAS 를 먼저 지운다. 행이 먼저 사라지면 어떤 파일이 있었는지 알 길이 없다.
  await deletePostMedia(id)
  await prisma.websitePost.delete({ where: { id } })
  return true
}

/**
 * id 배열 순서대로 position 을 다시 매긴다. 배열에 없는 글은 그 뒤에 기존 순서대로 붙는다.
 *
 * position 은 **목록별로** 센다(뉴스 0..n · 라이브러리 0..m). 한 줄로 세면 두 목록이
 * 서로의 순서를 흔든다 — 라이브러리 글을 위로 올렸는데 뉴스 순서가 바뀌는 식이다.
 * 그래서 받은 배열을 분류별로 나눠 각각 0 부터 다시 매긴다.
 */
export async function reorderPosts(order: string[]): Promise<void> {
  const all = await prisma.websitePost.findMany({
    select: { id: true, category: true },
    orderBy: { position: "asc" },
  })
  const catOf = new Map(all.map((p) => [p.id, p.category]))
  const updates: { id: string; position: number }[] = []
  for (const category of ["news", "library"]) {
    const ids = all.filter((p) => p.category === category).map((p) => p.id)
    const head = order.filter((id) => catOf.get(id) === category && ids.includes(id))
    const tail = ids.filter((id) => !head.includes(id))
    ;[...head, ...tail].forEach((id, position) => updates.push({ id, position }))
  }
  await prisma.$transaction(
    updates.map((u) => prisma.websitePost.update({ where: { id: u.id }, data: { position: u.position } }))
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
