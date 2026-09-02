// Phase A — 카톡 메시지를 옴니스 채팅으로 옮긴다.
//
//   npx tsx import-tools/import-messages.ts [--dry]
//
// 멱등: sourceId 유니크 제약으로 이미 넣은 메시지는 건너뛴다. 중간에 끊겨도 다시 돌리면 이어진다.
// 부수효과 없음: AI·알림·임베딩을 타지 않는다. 1년 전 대화 때문에 오늘 알림이 오면 안 된다.
import {
  prisma, loadSessions, ROOMS, messageSourceId, parseKst, resolveUsers,
} from "./kakao-common"

const DRY = process.argv.includes("--dry")

async function main() {
  const sessions = loadSessions()
  const userBySpeaker = await resolveUsers()

  // 이식 대상만 추린다 (1:1 대화 제외).
  const rows: { sourceId: string; roomId: string; authorId: string; content: string; createdAt: Date }[] = []
  const skippedRooms = new Map<string, number>()
  const unknownSpeakers = new Map<string, number>()

  for (const s of sessions) {
    const room = ROOMS[s.room]
    if (!room) {
      skippedRooms.set(s.room, (skippedRooms.get(s.room) ?? 0) + s.msgs.length)
      continue
    }
    for (const m of s.msgs) {
      const authorId = userBySpeaker.get(m.u)
      if (!authorId) {
        unknownSpeakers.set(m.u, (unknownSpeakers.get(m.u) ?? 0) + 1)
        continue
      }
      rows.push({
        sourceId: messageSourceId(s.room, m),
        roomId: room.id,
        authorId,
        content: m.m,
        createdAt: parseKst(m.t),
      })
    }
  }

  // 같은 사람이 같은 시각에 같은 말을 한 중복 원본이 있으면 하나만 남긴다.
  const unique = new Map(rows.map((r) => [r.sourceId, r]))
  const list = [...unique.values()].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  console.log(`대상 ${list.length}건 (원본 ${rows.length}건 중 중복 ${rows.length - unique.size}건 제거)`)
  for (const [room, n] of skippedRooms) console.log(`  제외: ${room} ${n}건 (1:1 대화)`)
  for (const [u, n] of unknownSpeakers) console.log(`  ⚠ 매핑 없는 발화자: ${u} ${n}건`)
  if (list.length > 0) {
    console.log(`  기간 ${list[0].createdAt.toISOString().slice(0, 10)} ~ ${list[list.length - 1].createdAt.toISOString().slice(0, 10)}`)
  }
  if (DRY) { console.log("\n--dry — 쓰지 않고 종료"); await prisma.$disconnect(); return }

  for (const room of Object.values(ROOMS)) {
    await prisma.chatRoom.upsert({ where: { id: room.id }, update: {}, create: { id: room.id, name: room.name } })
  }

  // createMany + skipDuplicates 로 이미 들어간 건 건너뛴다.
  const CHUNK = 500
  let inserted = 0
  for (let i = 0; i < list.length; i += CHUNK) {
    const { count } = await prisma.chatMessage.createMany({ data: list.slice(i, i + CHUNK), skipDuplicates: true })
    inserted += count
    process.stdout.write(`\r  넣는 중 ${Math.min(i + CHUNK, list.length)}/${list.length}`)
  }
  console.log(`\n  새로 넣은 메시지 ${inserted}건 · 이미 있던 것 ${list.length - inserted}건`)

  // Prisma 는 @updatedAt 에 준 값을 무시하고 삽입 시각으로 덮어쓴다.
  // 대시보드가 updatedAt 내림차순으로 "최근"을 뽑으므로 그대로 두면 1년치가 최근으로 도배된다.
  // ChatMessage 에는 updatedAt 이 없지만, 같은 이유로 Task 이식에서도 이 교정이 필요하다.
  const total = await prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } })
  console.log(`  이식된 메시지 총 ${total}건`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error("실패:", e); await prisma.$disconnect(); process.exit(1) })
