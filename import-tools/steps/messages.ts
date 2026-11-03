// 3단계 — 카톡 메시지를 옴니스 채팅으로 옮긴다 (분류와 무관하게 전량).
//
// 멱등: sourceId 유니크 제약으로 이미 넣은 메시지는 건너뛴다. 중간에 끊겨도 다시 돌리면 이어진다.
// 부수효과 없음: AI·알림을 타지 않는다. 1년 전 대화 때문에 오늘 알림이 오면 안 된다.
import { prisma, IMPORT_CONFIG, ROOMS, ensureRooms, resolveRoomIds, touchRooms, messageSourceId, parseKst, resolveUsers, type RawSession } from "../kakao-common"
import { matchHandCopies } from "../hand-copies"
import { copyRoomIds, externalSpeakerIdOf, speakerTarget, type ExternalDef } from "../rooms-config"
import { SYSTEM_USER_ID, getSystemUserId } from "../../lib/system-user"

export async function importMessages(sessions: RawSession[], opts: { dry: boolean }): Promise<{ inserted: number; total: number }> {
  const userBySpeaker = await resolveUsers()
  const roomIds = await resolveRoomIds()

  const rows: { sourceId: string; roomId: string; authorId: string; externalSpeakerId: string | null; content: string; createdAt: Date; roomKey: string }[] = []
  const unknownSpeakers = new Map<string, number>()
  const externals = new Map<string, { def: ExternalDef; n: number }>()

  for (const s of sessions) {
    const room = ROOMS[s.room]
    if (!room) continue
    for (const m of s.msgs) {
      const who = speakerTarget(room, m.u, IMPORT_CONFIG)
      const authorId = who?.type === "user" ? userBySpeaker.get(m.u) : who?.type === "external" ? SYSTEM_USER_ID : undefined
      if (!authorId) { unknownSpeakers.set(m.u, (unknownSpeakers.get(m.u) ?? 0) + 1); continue }
      let externalSpeakerId: string | null = null
      if (who?.type === "external") {
        externalSpeakerId = externalSpeakerIdOf(who.def)
        externals.set(externalSpeakerId, { def: who.def, n: (externals.get(externalSpeakerId)?.n ?? 0) + 1 })
      }
      rows.push({ sourceId: messageSourceId(s.room, m), roomId: roomIds.get(s.room)!, authorId, externalSpeakerId, content: m.m, createdAt: parseKst(m.t), roomKey: s.room })
    }
  }
  for (const [u, n] of unknownSpeakers) console.log(`  ⚠ 넣지 않는 발화자: ${u} ${n}건 — import-config.json 의 speakers · externals 에 없거나, 전사방의 외부 발화자다`)
  if (externals.size > 0) console.log(`  외부 발화자 ${externals.size}명 · ${[...externals.values()].reduce((a, e) => a + e.n, 0)}건 (참여자 전용 방)`)

  const unique = new Map(rows.map((r) => [r.sourceId, r]))
  const sorted = [...unique.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  // 사람이 손으로 옮겨 둔 사본이 있는 메시지는 넣지 않는다 — 같은 말이 두 번 보인다. 방마다 자기 방에서만 찾는다.
  const skip = new Set<string>()
  const byRoom = new Map<string, typeof sorted>()
  for (const r of sorted) byRoom.set(r.roomKey, [...(byRoom.get(r.roomKey) ?? []), r])
  let copyCount = 0
  const names = new Map<string, string>()
  for (const [key, list] of byRoom) {
    const copies = await prisma.chatMessage.findMany({
      where: {
        sourceId: null, kind: "NORMAL", deletedAt: null,
        roomId: { in: copyRoomIds(roomIds.get(key)!, ROOMS[key]) },
        createdAt: { gte: list[0].createdAt, lte: new Date(list[list.length - 1].createdAt.getTime() + 3 * 86400000) },
      },
      select: { id: true, authorId: true, content: true, createdAt: true },
    })
    if (copies.length === 0) continue
    copyCount += copies.length
    const matched = matchHandCopies(list, copies)
    for (const id of matched.skip) skip.add(id)
    if (names.size === 0) for (const u of await prisma.user.findMany({ select: { id: true, name: true } })) names.set(u.id, u.name)
    for (const c of matched.unmatched) {
      const kst = new Date(c.createdAt.getTime() + 9 * 3600000).toISOString().slice(5, 16).replace("T", " ")
      console.log(`    · 짝 없음 ${kst} ${names.get(c.authorId) ?? "?"}: ${c.content.replace(/\s+/g, " ").slice(0, 60)}`)
    }
  }
  if (copyCount > 0) console.log(`  손으로 옮긴 사본 ${copyCount}건 중 카톡 원본과 짝이 맞은 ${skip.size}건 → 그 원본은 넣지 않는다`)
  const list = sorted.filter((r) => !skip.has(r.sourceId))

  const existing = await prisma.chatMessage.count({ where: { sourceId: { in: list.map((r) => r.sourceId) } } })
  console.log(`  대상 ${list.length}건 · 이미 있음 ${existing}건 · 새로 넣을 것 ${list.length - existing}건`)
  if (opts.dry) return { inserted: 0, total: existing }

  await ensureRooms()
  if (externals.size > 0) {
    await getSystemUserId()
    for (const [id, { def }] of externals) {
      const data = { name: def.name.trim(), org: def.org?.trim() || null, title: def.title?.trim() || null }
      await prisma.externalSpeaker.upsert({ where: { id }, update: data, create: { id, ...data } })
    }
  }

  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < list.length; i += CHUNK) {
    const data = list.slice(i, i + CHUNK).map((r) => ({ sourceId: r.sourceId, roomId: r.roomId, authorId: r.authorId, externalSpeakerId: r.externalSpeakerId, content: r.content, createdAt: r.createdAt }))
    const { count } = await prisma.chatMessage.createMany({ data, skipDuplicates: true })
    inserted += count
  }
  await touchRooms()
  const total = await prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } })
  console.log(`  새로 넣은 메시지 ${inserted}건 · 이식된 메시지 총 ${total}건`)
  return { inserted, total }
}
