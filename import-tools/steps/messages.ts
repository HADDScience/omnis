// 3단계 — 카톡 메시지를 옴니스 채팅으로 옮긴다 (분류와 무관하게 전량).
//
// 멱등: sourceId 유니크 제약으로 이미 넣은 메시지는 건너뛴다. 중간에 끊겨도 다시 돌리면 이어진다.
// 부수효과 없음: AI·알림을 타지 않는다. 1년 전 대화 때문에 오늘 알림이 오면 안 된다.
import { prisma, ROOMS, messageSourceId, parseKst, resolveUsers, type RawSession } from "../kakao-common"
import { matchHandCopies } from "../hand-copies"

export async function importMessages(sessions: RawSession[], opts: { dry: boolean }): Promise<{ inserted: number; total: number }> {
  const userBySpeaker = await resolveUsers()

  const rows: { sourceId: string; roomId: string; authorId: string; content: string; createdAt: Date }[] = []
  const unknownSpeakers = new Map<string, number>()

  for (const s of sessions) {
    const room = ROOMS[s.room]
    if (!room) continue
    for (const m of s.msgs) {
      const authorId = userBySpeaker.get(m.u)
      if (!authorId) { unknownSpeakers.set(m.u, (unknownSpeakers.get(m.u) ?? 0) + 1); continue }
      rows.push({ sourceId: messageSourceId(s.room, m), roomId: room.id, authorId, content: m.m, createdAt: parseKst(m.t) })
    }
  }
  for (const [u, n] of unknownSpeakers) console.log(`  ⚠ 매핑 없는 발화자: ${u} ${n}건 — kakao-common.ts 의 SPEAKER_TO_USER 에 추가해야 들어간다`)

  const unique = new Map(rows.map((r) => [r.sourceId, r]))
  const sorted = [...unique.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  // 사람이 손으로 옮겨 둔 사본이 있는 메시지는 넣지 않는다 — 같은 말이 두 번 보인다.
  const copies = sorted.length === 0 ? [] : await prisma.chatMessage.findMany({
    where: {
      sourceId: null, kind: "NORMAL", deletedAt: null,
      createdAt: { gte: sorted[0].createdAt, lte: new Date(sorted[sorted.length - 1].createdAt.getTime() + 3 * 86400000) },
    },
    select: { id: true, authorId: true, content: true, createdAt: true },
  })
  const { skip, unmatched } = matchHandCopies(sorted, copies)
  const list = sorted.filter((r) => !skip.has(r.sourceId))
  if (copies.length > 0) {
    console.log(`  손으로 옮긴 사본 ${copies.length}건 중 카톡 원본과 짝이 맞은 ${skip.size}건 → 그 원본은 넣지 않는다`)
    const names = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    for (const c of unmatched) {
      const kst = new Date(c.createdAt.getTime() + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ")
      console.log(`    · 짝 없음 ${kst} ${names.get(c.authorId) ?? "?"}: ${c.content.replace(/\s+/g, " ").slice(0, 60)}`)
    }
  }

  const existing = await prisma.chatMessage.count({ where: { sourceId: { in: list.map((r) => r.sourceId) } } })
  console.log(`  대상 ${list.length}건 · 이미 있음 ${existing}건 · 새로 넣을 것 ${list.length - existing}건`)
  if (opts.dry) return { inserted: 0, total: existing }

  for (const room of Object.values(ROOMS)) {
    await prisma.chatRoom.upsert({ where: { id: room.id }, update: {}, create: { id: room.id, name: room.name } })
  }

  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < list.length; i += CHUNK) {
    const { count } = await prisma.chatMessage.createMany({ data: list.slice(i, i + CHUNK), skipDuplicates: true })
    inserted += count
  }
  const total = await prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } })
  console.log(`  새로 넣은 메시지 ${inserted}건 · 이식된 메시지 총 ${total}건`)
  return { inserted, total }
}
