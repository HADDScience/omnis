import { prisma } from "@/lib/db"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { pilotWeeks, summarizePilot, type PilotSummary } from "./pilot"

export interface PilotFilter {
  userId: string | null
  roomId: string | null
}

export interface PilotView extends PilotSummary {
  /** 필터 목록과 표의 이름. 관리자 화면에서만 읽는다 — 측정 기록에는 이름이 없다 */
  names: { people: { id: string; name: string }[]; rooms: { id: string; name: string }[] }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

/** ?person=&room= — 식별자 꼴이 아니면 전체로 본다 */
export function parsePilotFilter(params: Record<string, string | string[] | undefined>): PilotFilter {
  const one = (v: string | string[] | undefined) => (typeof v === "string" && ID.test(v) ? v : null)
  return { userId: one(params.person), roomId: one(params.room) }
}

/**
 * 시범 운영 칸. 사람 필터는 모든 값에, 방 필터는 글 수에만 걸린다(푸시 · 검색 · 질문은 방을 남기지 않는다).
 *
 * 「직접 쓴 글」 = 옴니스에서 사람이 쓴 일반 글 — 이식 글(sourceId 있음) · 옴니스 답 · 시스템 글 · 지운 글 · 옴니스 1:1 방은 뺀다.
 * 「카톡 이식 글」 = sourceId 가 "kakao:" 로 시작하는 글. 시각은 카톡에서 쓴 시각이다.
 * 조건은 null 이면 꺼지는 고정 SQL — Prisma.sql 조각은 next dev 번들에서 값으로 바인딩된다(api/chat/search 와 같은 이유).
 */
export async function loadPilotView(filter: PilotFilter, now = new Date()): Promise<PilotView> {
  const weeks = pilotWeeks(now)
  const from = weeks[0]
  const { userId, roomId } = filter

  const [events, roomDays, writerDays, queries, people, rooms] = await Promise.all([
    prisma.uiEvent.findMany({
      where: { at: { gte: from }, ...(userId ? { userId } : {}) },
      select: { userId: true, name: true, value: true, at: true },
    }),
    prisma.$queryRaw<{ roomId: string; day: Date; direct: number; kakao: number }[]>`
      SELECT m."roomId", date_trunc('day', m."createdAt" + interval '9 hours') - interval '9 hours' AS day,
        count(*) FILTER (WHERE m."sourceId" IS NULL AND m."authorId" <> ${SYSTEM_USER_ID})::int AS direct,
        count(*) FILTER (WHERE m."sourceId" LIKE 'kakao:%')::int AS kakao
      FROM "ChatMessage" m JOIN "ChatRoom" r ON r.id = m."roomId"
      WHERE m."createdAt" >= ${from} AND m.kind = 'NORMAL' AND m."deletedAt" IS NULL AND m."omnisQueryId" IS NULL
        AND m.content NOT LIKE '\\_\\_%' AND r.kind <> 'OMNIS_DM'
        AND (${userId}::text IS NULL OR m."authorId" = ${userId}::text)
        AND (${roomId}::text IS NULL OR m."roomId" = ${roomId}::text)
      GROUP BY 1, 2`,
    prisma.$queryRaw<{ userId: string; day: Date }[]>`
      SELECT DISTINCT m."authorId" AS "userId", date_trunc('day', m."createdAt" + interval '9 hours') - interval '9 hours' AS day
      FROM "ChatMessage" m
      WHERE m."createdAt" >= ${from} AND m."sourceId" IS NULL AND m."authorId" <> ${SYSTEM_USER_ID} AND m.kind = 'NORMAL'
        AND (${userId}::text IS NULL OR m."authorId" = ${userId}::text)`,
    prisma.$queryRaw<{ userId: string; at: Date; photo: boolean }[]>`
      SELECT q."userId", q."createdAt" AS at, (q.sources::jsonb @> '[{"source":"PHOTO"}]'::jsonb) AS photo
      FROM "OmnisQuery" q
      WHERE q."createdAt" >= ${from} AND (${userId}::text IS NULL OR q."userId" = ${userId}::text)`,
    prisma.user.findMany({ where: { id: { not: SYSTEM_USER_ID } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.chatRoom.findMany({ where: { kind: { not: "OMNIS_DM" } }, select: { id: true, name: true } }),
  ])

  const summary = summarizePilot({ weeks, events, roomDays, writerDays, queries })
  return {
    ...summary,
    names: {
      people: people,
      rooms: [...rooms].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    },
  }
}
