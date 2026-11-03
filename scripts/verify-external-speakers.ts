/**
 * 외부 발화자 · 참여자 전용 이식 검증 — 지어낸 이름으로 실제 이식 단계와 읽는 경로를 돌린다. 새어야 하지 않는 경우를 함께 본다.
 *
 *   DATABASE_URL=postgresql://…localhost…/<이름에 test 가 든 DB> npx tsx scripts/verify-external-speakers.ts
 *
 * 운영에 닿지 않게 localhost + test 이름이 아니면 멈춘다. KAKAO_DATA_DIR 은 임시 폴더다.
 */
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const url = process.env.DATABASE_URL ?? ""
if (!/localhost|127\.0\.0\.1/.test(url) || !/test/.test(url.split("/").pop() ?? "")) throw new Error("localhost 의 test DB 에서만 돈다. 중단.")
delete process.env.GEMINI_API_KEY // 색인 경로가 Gemini 를 부르면 바로 실패한다 — 색인 대상이 아니어야 한다

const dir = mkdtempSync(join(tmpdir(), "kakao-ext-"))
process.env.KAKAO_DATA_DIR = dir
const A = "시험직원갑", B = "시험직원을", C = "시험직원병"
const EXT = { name: "시험외부인", org: "예시기관", title: "연구원" }
writeFileSync(join(dir, "import-config.json"), JSON.stringify({
  rooms: {
    "예시 전사방": { id: "ext-test-company", name: "예시 전사방", kind: "COMPANY" },
    "예시 단톡": { id: "ext-test-group", name: "예시 단톡", kind: "GROUP", members: [A, B] },
    "예시 사본방": { id: "ext-test-copies", name: "예시 사본방", kind: "GROUP", members: [A], copiesFrom: ["ext-test-group"] },
    "예시 1:1": { name: "예시 1:1", kind: "DM", dm: [A, B] },
    "예시 새 1:1": { name: "예시 새 1:1", kind: "DM", dm: [A, C] },
  },
  speakers: { "갑 표시명": A, "을 표시명": B },
  externals: { "외부 표시명": EXT },
}))

let fails = 0
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) fails++ }

async function main() {
  const { prisma, messageSourceId, sessionize } = await import("../import-tools/kakao-common")
  const { importMessages } = await import("../import-tools/steps/messages")
  const { pendingSessions } = await import("../import-tools/steps/classify")
  const { dmKeyOf } = await import("../lib/chat-people-rules")
  const { roomAccess, PUBLIC_MESSAGE_WHERE } = await import("../lib/chat-rooms")
  const { displayAuthor, EXTERNAL_SPEAKER_SELECT, NOT_EXTERNAL_WHERE } = await import("../lib/external-speaker")
  const { syncEmbeddings, withFollowUps } = await import("../lib/embeddings")
  const { findVisibleFile } = await import("../lib/file-access-server")
  const { PUBLIC_FILE_WHERE, visibleFileWhere } = await import("../lib/file-access")
  const { importedFilePrivateTo } = await import("../import-tools/rooms-config")

  const user = (name: string) => prisma.user.upsert({ where: { name }, update: {}, create: { name, passwordHash: "!" }, select: { id: true } })
  const [a, b, c] = [await user(A), await user(B), await user(C)]
  const notifBefore = await prisma.notification.count()
  const usersBefore = await prisma.user.count()

  // 앱에서 이미 연 1:1 — 이식은 이 방에 들어가야 한다
  const dmKey = dmKeyOf(a.id, b.id)
  const appDm = await prisma.chatRoom.create({ data: { kind: "DM", dmKey, name: `${A}, ${B}`, members: { create: [{ userId: a.id }, { userId: b.id }] } } })
  await prisma.chatRoom.create({ data: { id: "ext-test-company", name: "예시 전사방", kind: "COMPANY" } })

  // 사본 — 다른 방에 있는 같은 말
  await prisma.chatRoom.create({ data: { id: "ext-test-group", name: "예시 단톡", kind: "GROUP" } })
  await prisma.chatMessage.create({ data: { roomId: "ext-test-group", authorId: a.id, content: "사본이 있는 예시 문장입니다", createdAt: new Date("2026-09-01T10:00:30+09:00") } })
  await prisma.chatRoom.create({ data: { id: "ext-test-other", name: "상관없는 방", kind: "GROUP" } })
  await prisma.chatMessage.create({ data: { roomId: "ext-test-other", authorId: a.id, content: "다른 방에만 사본이 있는 문장입니다", createdAt: new Date("2026-09-01T10:01:30+09:00") } })

  const row = (room: string, t: string, u: string, m: string) => ({ room, t: `2026-09-01 ${t}`, u, m })
  const rows = [
    row("예시 전사방", "09:00:00", "외부 표시명", "전사방의 외부 발화자 글"),
    row("예시 전사방", "09:00:10", "갑 표시명", "전사방의 직원 글"),
    row("예시 단톡", "09:00:00", "외부 표시명", "외부 발화자의 참여자 전용 글입니다"),
    row("예시 단톡", "09:00:10", "을 표시명", "직원 글입니다"),
    row("예시 단톡", "09:00:20", "모르는 표시명", "매핑 없는 사람 글"),
    row("예시 사본방", "10:00:00", "갑 표시명", "사본이 있는 예시 문장입니다"),
    row("예시 사본방", "10:01:00", "갑 표시명", "다른 방에만 사본이 있는 문장입니다"),
    row("예시 1:1", "09:00:00", "갑 표시명", "1:1 글"),
    row("예시 새 1:1", "09:00:00", "갑 표시명", "새 1:1 글"),
  ]
  const sessions = sessionize(rows)
  const src = (r: (typeof rows)[number]) => messageSourceId(r.room, r)

  console.log("건식")
  const roomsBefore = await prisma.chatRoom.count()
  const msgsBefore = await prisma.chatMessage.count()
  await importMessages(sessions, { dry: true })
  check("--dry 는 방 · 글 · 외부 발화자를 쓰지 않음", await prisma.chatRoom.count() === roomsBefore && await prisma.chatMessage.count() === msgsBefore && await prisma.externalSpeaker.count() === 0)

  console.log("이식")
  await importMessages(sessions, { dry: false })
  const get = (r: (typeof rows)[number]) => prisma.chatMessage.findUnique({ where: { sourceId: src(r) }, include: { author: { select: { id: true, name: true } }, externalSpeaker: EXTERNAL_SPEAKER_SELECT } })
  const extMsg = (await get(rows[2]))!
  check("외부 글이 들어가고 작성자 칸은 시스템 계정", extMsg.authorId === "system" && !!extMsg.externalSpeakerId)
  check("화면 이름은 이름 · 소속 · 직급", displayAuthor(extMsg.author, extMsg.externalSpeaker).name === "시험외부인 · 예시기관 · 연구원")
  check("화면 작성자 id 가 system 이 아님 (옴니스 글로 그리지 않음)", displayAuthor(extMsg.author, extMsg.externalSpeaker).id.startsWith("external:"))
  check("전사방에는 외부 글이 들어가지 않음", (await get(rows[0])) === null)
  check("전사방의 직원 글은 들어감", (await get(rows[1]))?.authorId === a.id)
  check("매핑 없는 사람 글은 들어가지 않음", (await get(rows[4])) === null)
  const sp = await prisma.externalSpeaker.findMany()
  check("저장 칸은 이름 · 소속 · 직급뿐", sp.length === 1 && Object.keys(sp[0]).sort().join() === "id,name,org,title")
  check("계정을 만들지 않음 (User 는 시스템 계정만 늘 수 있음)", await prisma.user.count({ where: { id: { not: "system" } } }) === usersBefore)
  check("외부인 이름의 계정 없음", (await prisma.user.findFirst({ where: { name: EXT.name } })) === null)
  check("알림이 나가지 않음", await prisma.notification.count() === notifBefore)

  console.log("1:1 · dmKey")
  check("앱에서 이미 연 1:1 에 들어감", (await get(rows[7]))?.roomId === appDm.id)
  const newDm = await prisma.chatRoom.findUnique({ where: { dmKey: dmKeyOf(a.id, c.id) }, include: { members: true } })
  check("없으면 dmKey 로 만들고 두 사람이 참여자", newDm?.kind === "DM" && newDm.members.length === 2 && (await get(rows[8]))?.roomId === newDm.id)

  console.log("사본 짝 맞추기")
  check("copiesFrom 방의 사본과는 짝이 맞아 넣지 않음", (await get(rows[5])) === null)
  check("지정하지 않은 방의 같은 말은 짝이 아님 — 원본이 들어감", (await get(rows[6])) !== null)

  console.log("참여자 밖으로 새는 길")
  check("참여자는 방을 읽음", await roomAccess("ext-test-group", b.id) === "ok")
  check("비참여자는 방을 못 읽음", await roomAccess("ext-test-group", c.id) === "forbidden")
  check("전체 피드 조건에 걸리지 않음", (await prisma.chatMessage.findFirst({ where: { id: extMsg.id, ...PUBLIC_MESSAGE_WHERE } })) === null)
  await syncEmbeddings("CHAT_MESSAGE", extMsg.id)
  check("색인되지 않음", await prisma.embeddingChunk.count({ where: { sourceId: extMsg.id } }) === 0)
  // 방 종류가 바뀌어도(사고) 색인되지 않아야 한다
  await prisma.chatRoom.update({ where: { id: "ext-test-group" }, data: { kind: "COMPANY" } })
  await syncEmbeddings("CHAT_MESSAGE", extMsg.id)
  check("방이 전사방으로 바뀌어도 색인되지 않음", await prisma.embeddingChunk.count({ where: { sourceId: extMsg.id } }) === 0)
  await prisma.chatRoom.update({ where: { id: "ext-test-group" }, data: { kind: "GROUP" } })
  check("참여자 전용 방은 분류 대상이 아님 → Claude 로 나가지 않음", pendingSessions(sessions, new Map()).every((s) => s.room === "예시 전사방"))
  check("업무 카드가 생기지 않고 연결도 없음", extMsg.taskId === null && await prisma.task.count() === 0)

  // 외부 글이 사고로 카드에 연결돼도 카드 경로에서 내보내지 않는다
  const task = await prisma.task.create({ data: { name: "시험 업무", slug: "ext-test-task", instructorId: a.id } })
  const head = (await get(rows[1]))!
  await prisma.chatMessage.update({ where: { id: head.id }, data: { taskId: task.id } })
  await prisma.chatMessage.update({ where: { id: extMsg.id }, data: { taskId: task.id, createdAt: new Date(head.createdAt.getTime() + 60000) } })
  const seen = await prisma.chatMessage.findMany({ where: { taskId: task.id, ...NOT_EXTERNAL_WHERE }, select: { id: true } })
  check("카드 스레드 조건에서 빠짐", seen.length === 1 && seen[0].id === head.id)
  const follow = await withFollowUps([{ id: "c", source: "CHAT_MESSAGE", sourceId: head.id, title: "t", content: "기준 글", score: 1 } as never])
  check("AI 답변의 후속 대화에 붙지 않음", !JSON.stringify(follow).includes("외부 발화자의 참여자 전용 글"))
  await prisma.chatMessage.update({ where: { id: extMsg.id }, data: { taskId: null } })

  console.log("첨부")
  const fresh = (await prisma.chatMessage.findUnique({ where: { id: extMsg.id }, select: { authorId: true, room: { select: { kind: true } } } }))!
  const file = await prisma.file.create({ data: { name: "시험.png", path: "/x", size: 1, mimeType: "image/png", messageId: extMsg.id, privateToUserId: importedFilePrivateTo(fresh) } })
  check("참여자는 첨부를 봄", (await findVisibleFile(file.id, b.id)) !== null)
  check("비참여자는 첨부를 못 봄", (await findVisibleFile(file.id, c.id)) === null)
  // 카드 화면 · get_task 의 조건 — 글이 카드에 연결돼도 첨부 이름은 참여자에게만 나온다
  await prisma.chatMessage.update({ where: { id: extMsg.id }, data: { taskId: task.id } })
  const cardFiles = async (userId: string) => (await prisma.chatMessage.findUniqueOrThrow({ where: { id: extMsg.id }, select: { files: { where: visibleFileWhere(userId), select: { id: true } } } })).files.length
  check("카드에 연결된 글의 첨부 — 참여자 목록에는 나옴", (await cardFiles(b.id)) === 1)
  check("카드에 연결된 글의 첨부 — 비참여자 목록에는 안 나옴", (await cardFiles(c.id)) === 0)
  check("재구성에 넘기는 조건에서 빠짐", (await prisma.file.count({ where: { id: file.id, ...PUBLIC_FILE_WHERE } })) === 0)
  await prisma.chatMessage.update({ where: { id: extMsg.id }, data: { taskId: null } })

  console.log("멱등")
  const n = await prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } })
  await importMessages(sessions, { dry: false })
  check("다시 돌려도 글 · 외부 발화자가 늘지 않음", await prisma.chatMessage.count({ where: { sourceId: { startsWith: "kakao:" } } }) === n && await prisma.externalSpeaker.count() === 1)

  await prisma.$disconnect()
  console.log(fails ? `\n✗ 실패 ${fails}` : "\n모두 통과")
  process.exit(fails ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
