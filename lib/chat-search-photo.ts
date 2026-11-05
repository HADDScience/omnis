// 전사방 채팅 검색의 사진 찾기 — File.description(PHOTO 색인에 들어가는 글)에서 글자 일치로 찾는다.
// 새 임베딩 호출은 없다. 형식은 lib/photo-text.ts 의 photoIndexText 를 따른다.
import { prisma } from "@/lib/db"

/**
 * 설명 · 사진 속 글자 · 검색어만 남기는 정규식. 「사진」 으로 찾으면 라벨 「사진 속 글자:」 에 걸려
 * 설명이 있는 사진 전부가 나오므로 라벨을 걷고, 종류 · 용도 줄은 통째로 뺀다.
 * SQL(regexp_replace, 플래그 gn)과 JS(플래그 gm)가 같은 문자열을 쓴다.
 */
const SEARCH_TEXT_STRIP = String.raw`^(종류|용도): [^\n]*\n?|^(설명|사진 속 글자|검색어): `

/** description 에서 검색 대상 글자만 — SQL 의 regexp_replace 와 같은 결과 */
export function photoSearchText(description: string): string {
  return description.replace(new RegExp(SEARCH_TEXT_STRIP, "gm"), "")
}

/**
 * 조건에 맞는 글 id 를 최신순으로. 글 본문 일치와 사진 일치를 한 쿼리에 합쳐 한 글은 한 번만 나온다.
 * 조건은 null 이면 꺼지는 고정 SQL — Prisma.sql 조각은 next dev 번들에서 값으로 바인딩된다(api/chat/search 의 count 와 같은 이유).
 */
export async function messageIdsMatchingTextOrPhoto(input: {
  roomId: string
  pattern: string
  authorId: string | null
  before: Date | null
  take: number
}): Promise<string[]> {
  const { roomId, pattern, authorId, before, take } = input
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT m.id FROM "ChatMessage" m
    WHERE m."roomId" = ${roomId}
      AND m.kind = 'NORMAL' AND m."deletedAt" IS NULL
      AND (${authorId}::text IS NULL OR m."authorId" = ${authorId})
      AND (${before}::timestamp IS NULL OR m."createdAt" < ${before})
      AND (
        m.content ILIKE ${pattern}
        OR m.id IN (
          SELECT f."messageId" FROM "File" f
          WHERE f."messageId" IS NOT NULL AND f."privateToUserId" IS NULL AND f."mimeType" LIKE 'image/%'
            AND f.description ILIKE ${pattern}
            AND regexp_replace(f.description, ${SEARCH_TEXT_STRIP}, '', 'gn') ILIKE ${pattern}
        )
      )
    ORDER BY m."createdAt" DESC
    LIMIT ${take}`
  return rows.map((r) => r.id)
}

/** 「3/120」 의 120 — 시스템 표식을 뺀 전체 수 */
export async function countMatchingTextOrPhoto(input: { roomId: string; pattern: string; authorId: string | null }): Promise<number> {
  const { roomId, pattern, authorId } = input
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "ChatMessage" m
    WHERE m."roomId" = ${roomId}
      AND m.kind = 'NORMAL' AND m."deletedAt" IS NULL
      AND left(m.content, 2) <> '__' AND left(m.content, 1) <> '🤖'
      AND (${authorId}::text IS NULL OR m."authorId" = ${authorId})
      AND (
        m.content ILIKE ${pattern}
        OR m.id IN (
          SELECT f."messageId" FROM "File" f
          WHERE f."messageId" IS NOT NULL AND f."privateToUserId" IS NULL AND f."mimeType" LIKE 'image/%'
            AND f.description ILIKE ${pattern}
            AND regexp_replace(f.description, ${SEARCH_TEXT_STRIP}, '', 'gn') ILIKE ${pattern}
        )
      )`
  return Number(rows[0]?.n ?? 0)
}

/** 이 글들에서 검색어가 걸린 사진 — 글마다 먼저 올라온 한 장. 사진으로 안 걸린 글은 없다 */
export async function matchedPhotos(messageIds: string[], pattern: string): Promise<Map<string, { fileId: string; description: string }>> {
  if (messageIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ messageId: string; id: string; description: string }[]>`
    SELECT DISTINCT ON (f."messageId") f."messageId", f.id, f.description FROM "File" f
    WHERE f."messageId" = ANY(${messageIds}::text[])
      AND f."privateToUserId" IS NULL AND f."mimeType" LIKE 'image/%'
      AND f.description ILIKE ${pattern}
      AND regexp_replace(f.description, ${SEARCH_TEXT_STRIP}, '', 'gn') ILIKE ${pattern}
    ORDER BY f."messageId", f."createdAt", f.id`
  return new Map(rows.map((r) => [r.messageId, { fileId: r.id, description: r.description }]))
}
