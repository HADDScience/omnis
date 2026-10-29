/**
 * 채팅 · 업무 · 일정 푸시 — 「누구에게 무엇이 나갔는가」 를 실제 코드 경로로 돌려 발송 기록(PUSH_LOG_FILE)으로 본다.
 * 푸시 서비스에는 보내지 않는다(PUSH_DRY_RUN=1). 로컬 DB 는 운영 스냅샷이라 실제 구독이 들어 있다.
 * 모델을 부르지 않는다(GEMINI 키를 빼고 돌린다 — 임베딩도 부르지 않는다).
 *
 *   env -u GEMINI_API_KEY PUSH_DRY_RUN=1 PUSH_LOG_FILE=/tmp/push.jsonl pnpm exec tsx --env-file=.env scripts/verify-notify.ts
 *
 * 시험용 사람 · 방 · 업무 · 캘린더를 만들고 끝에 지운다. 로컬 DB 가 아니면 멈춘다.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { prisma } from "../lib/db"
import { postChatMessage } from "../lib/chat-post"
import { loadPeopleRoom, openPeopleRoom, postPeopleMessage } from "../lib/chat-people"
import { dispatchAgentPush, dispatchChatPush } from "../lib/chat-push"
import { settleAfterResponse } from "../lib/after-response"
import { updateTask } from "../lib/task-update"
import { runTool } from "../lib/omnis-mcp"
import { callerFor } from "../lib/agent/tools"
import { upsertResources } from "../lib/caldav/sync"
import { notifyNewCalendarEvents } from "../lib/calendar-notify"
import { SYSTEM_USER_ID, getSystemUserId } from "../lib/system-user"

const LOG = process.env.PUSH_LOG_FILE ?? ""
if (!LOG || process.env.PUSH_DRY_RUN !== "1") throw new Error("PUSH_DRY_RUN=1 · PUSH_LOG_FILE 이 필요하다")
if (process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 를 빼고 돌린다(env -u GEMINI_API_KEY) — 모델 · 임베딩을 부르지 않게")
const db = new URL(process.env.DATABASE_URL!)
if (!["localhost", "127.0.0.1"].includes(db.hostname)) throw new Error(`로컬 DB 가 아니다: ${db.hostname}`)

const TAG = `vn${Date.now().toString(36)}`
let failed = 0
let passed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (ok) passed++
  else failed++
}

type Line = { userId: string; category: string | null; outcome: string; title: string; body?: string; tag?: string; url?: string; roomPath?: string }
writeFileSync(LOG, "")
let offset = 0
/** 앞 단계 뒤로 새로 쌓인 발송 기록 */
async function take(): Promise<Line[]> {
  await settleAfterResponse()
  const all = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []
  const fresh = all.slice(offset).map((l) => JSON.parse(l) as Line)
  offset = all.length
  return fresh
}
const ids = (lines: Line[], pred: (l: Line) => boolean = () => true) => new Set(lines.filter(pred).map((l) => l.userId))
const eqSet = (a: Set<string>, b: Iterable<string>) => {
  const bb = new Set(b)
  return a.size === bb.size && [...a].every((x) => bb.has(x))
}

const made = { users: [] as string[], rooms: [] as string[], tasks: [] as string[], calendars: [] as string[] }

async function main() {
  await getSystemUserId()
  const mk = async (n: string, role: "ADMIN" | "MEMBER" = "MEMBER") => {
    const u = await prisma.user.create({ data: { name: `__${TAG}_${n}`, email: `${TAG}.${n}@verify.local`, passwordHash: "!", role }, select: { id: true, name: true } })
    made.users.push(u.id)
    return u
  }
  const [A, B, C, D, E, F, G] = await Promise.all(["A", "B", "C", "D", "E", "F", "G"].map((n) => mk(n, n === "A" ? "ADMIN" : "MEMBER")))
  const name = (id: string) => [A, B, C, D, E, F, G].find((u) => u.id === id)?.name.replace(`__${TAG}_`, "") ?? id.slice(0, 6)
  const names = (s: Set<string>) => [...s].map(name).sort().join(",")
  // C 는 채팅 알림을 끈 사람, E 는 업무 알림을 끈 사람
  await prisma.notificationPref.create({ data: { userId: C.id, chatPush: false } })
  await prisma.notificationPref.create({ data: { userId: E.id, taskPush: false } })
  const active = new Set((await prisma.user.findMany({ where: { isActive: true }, select: { id: true } })).map((u) => u.id))

  // ─── 1. 전사방 ───
  console.log("\n[1] 전사방 — 구성원 전원 − 글쓴이 − 방 끈 사람 − 채팅 끈 사람")
  const companyId = `${TAG}-company`
  made.rooms.push(companyId)
  await prisma.chatRoom.create({ data: { id: companyId, name: "시험 전사방", kind: "COMPANY" } })
  await prisma.chatRoomPref.create({ data: { userId: B.id, roomKey: `room:${companyId}`, muted: true } })
  await postChatMessage({ user: A, roomId: companyId, content: "전체 공지 — 내일 10시 회의실" }, { deferRebuild: true })
  let lines = await take()
  const expectCompany = [...active].filter((id) => ![A.id, B.id, C.id, SYSTEM_USER_ID].includes(id))
  check(`받은 사람 = 활성 ${active.size}명 − A(글쓴이) − B(방 끔) − C(채팅 끔) = ${expectCompany.length}명`, eqSet(ids(lines), expectCompany), { got: ids(lines).size })
  check("모두 chat 종류 · 방 tag · 방 주소", lines.every((l) => l.category === "chat" && l.tag === `omnis:chat:room:${companyId}` && l.roomPath === `/chat/${companyId}`))
  check("본문 = 「보낸 사람: 앞부분」 · 제목 = 방 이름", lines[0]?.title === "시험 전사방" && lines[0]?.body === `${A.name}: 전체 공지 — 내일 10시 회의실`, lines[0])
  check("벨 행(Notification)은 만들지 않는다", (await prisma.notification.count({ where: { userId: { in: made.users }, type: { startsWith: "chat" } } })) === 0)

  // ─── 2. 업무방 ───
  console.log("\n[2] 업무방 — 담당 · 지시 · 글쓴 사람 · 즐겨찾기만")
  const task = await prisma.task.create({
    data: { name: `시험 업무 ${TAG}`, slug: `${TAG}-task`, instructorId: A.id, assignees: { create: [{ userId: B.id }, { userId: D.id }] } },
    select: { id: true, slug: true },
  })
  made.tasks.push(task.id)
  // F 는 전에 이 스레드에 글을 썼다, G 는 업무방을 즐겨찾기했다
  await prisma.chatMessage.create({ data: { roomId: companyId, authorId: F.id, content: "참고 자료 올립니다", taskId: task.id } })
  await prisma.chatRoomPref.create({ data: { userId: G.id, roomKey: `task:${task.id}`, favorite: true } })
  await postChatMessage({ user: D, roomId: companyId, taskId: task.id, content: "시약 견적 받았습니다" }, { deferRebuild: true })
  lines = await take()
  check(`받은 사람 = {A 지시, B 담당, F 글쓴, G 즐겨찾기} (D 글쓴이 제외) — 실제 ${names(ids(lines))}`, eqSet(ids(lines), [A.id, B.id, F.id, G.id]))
  check("업무와 무관한 구성원 · 방을 끈 전사방 설정과 상관없다", !lines.some((l) => !made.users.includes(l.userId)))
  check("업무방 주소 · 제목 # 업무명", lines.every((l) => l.roomPath === `/chat/task/${task.id}` && l.title === `# 시험 업무 ${TAG}`))

  await prisma.chatRoomPref.create({ data: { userId: B.id, roomKey: `task:${task.id}`, muted: true } })
  await postChatMessage({ user: D, roomId: companyId, taskId: task.id, content: "견적서 첨부" }, { deferRebuild: true })
  lines = await take()
  check(`B 가 업무방을 끄면 B 만 빠진다 — 실제 ${names(ids(lines))}`, eqSet(ids(lines), [A.id, F.id, G.id]))

  // 전사방에서 #슬러그 로 이은 글은 전사방 글이다
  await postChatMessage({ user: D, roomId: companyId, content: `#${task.slug} 전체에 공유합니다` }, { deferRebuild: true })
  lines = await take()
  check("전사방에서 #슬러그 로 쓴 글은 전사방 받는 사람(전원)에게", lines.length === [...active].filter((id) => ![D.id, B.id, C.id, SYSTEM_USER_ID].includes(id)).length && lines.every((l) => l.roomPath === `/chat/${companyId}`), { n: lines.length })

  // ─── 3. 사람 방 ───
  console.log("\n[3] 사람 1:1 · 단톡방 — 참여자만, 멘션 받는 사람은 멘션으로 한 번")
  const dm = await openPeopleRoom(A, { userIds: [B.id] })
  if (!dm.ok) throw new Error(dm.error)
  made.rooms.push(dm.value.roomId)
  await postPeopleMessage(A, (await loadPeopleRoom(dm.value.roomId, A.id))!, { content: "점심 같이 해요" })
  lines = await take()
  check("1:1 은 상대(B)만 · 제목 = 보낸 사람 · 본문 = 앞부분", lines.length === 1 && lines[0].userId === B.id && lines[0].title === A.name && lines[0].body === "점심 같이 해요", lines)

  const group = await openPeopleRoom(A, { userIds: [B.id, D.id, F.id], name: "시험 단톡" })
  if (!group.ok) throw new Error(group.error)
  made.rooms.push(group.value.roomId)
  const dName = D.name
  await postPeopleMessage(A, (await loadPeopleRoom(group.value.roomId, A.id))!, { content: `@${dName} 자료 확인 부탁해요` })
  lines = await take()
  const chatOnly = ids(lines, (l) => l.tag === `omnis:chat:room:${group.value.roomId}`)
  const mention = lines.filter((l) => l.tag === `omnis:${group.value.roomId}`)
  check(`단톡방 채팅 푸시 = {B, F} (D 는 멘션으로) — 실제 ${names(chatOnly)}`, eqSet(chatOnly, [B.id, F.id]))
  check("D 는 멘션 푸시 한 번(chat 종류 · 그 방 주소 · 벨 행 있음)", mention.length === 1 && mention[0].userId === D.id && mention[0].category === "chat" && mention[0].roomPath === `/chat/${group.value.roomId}`, mention)
  check("D 의 벨에 chat_mention 이 남는다", (await prisma.notification.count({ where: { userId: D.id, type: "chat_mention" } })) === 1)
  check("D 에게 같은 글로 두 번 가지 않는다", lines.filter((l) => l.userId === D.id).length === 1)

  // 방을 꺼도 멘션은 간다
  await prisma.chatRoomPref.create({ data: { userId: D.id, roomKey: `room:${group.value.roomId}`, muted: true } })
  await postPeopleMessage(A, (await loadPeopleRoom(group.value.roomId, A.id))!, { content: `@${dName} 한 번 더` })
  lines = await take()
  check("방을 끈 D 도 멘션 푸시는 받는다", lines.some((l) => l.userId === D.id && l.tag === `omnis:${group.value.roomId}`))
  await postPeopleMessage(A, (await loadPeopleRoom(group.value.roomId, A.id))!, { content: "멘션 없는 글" })
  lines = await take()
  check(`방을 끈 D 는 일반 글을 받지 않는다 — 실제 ${names(ids(lines))}`, eqSet(ids(lines), [B.id, F.id]))

  // ─── 4. 시스템 계정 · 옴니스 답 ───
  console.log("\n[4] 시스템 계정 글 · 옴니스 답")
  const sys = await dispatchChatPush({ room: { kind: "COMPANY", id: companyId, name: "시험 전사방" }, author: { id: SYSTEM_USER_ID, name: "Omnis" }, content: "🤖 재구성" })
  lines = await take()
  check("시스템 계정 글은 아무에게도 가지 않는다", sys.length === 0 && lines.length === 0)
  const omnis = await prisma.chatRoom.create({ data: { name: "마감 정리", kind: "OMNIS_DM", createdById: A.id, members: { create: [{ userId: A.id }] } }, select: { id: true } })
  made.rooms.push(omnis.id)
  await dispatchAgentPush({ roomId: omnis.id, userId: A.id, kind: "approval" })
  await dispatchAgentPush({ roomId: omnis.id, userId: A.id, kind: "answer", text: "**이번 주** 마감은 2건입니다" })
  lines = await take()
  check("확인 카드 · 답 → 방 주인 A 에게 두 번", lines.length === 2 && lines.every((l) => l.userId === A.id && l.roomPath === `/chat/${omnis.id}`), lines)
  check("확인 카드 본문 「확인이 필요해요」 · 답 본문은 기호를 뗀 앞부분", lines[0]?.body?.startsWith("확인이 필요해요") === true && lines[1]?.body === "이번 주 마감은 2건입니다", lines.map((l) => l.body))
  await prisma.chatRoomPref.create({ data: { userId: A.id, roomKey: `room:${omnis.id}`, muted: true } })
  await dispatchAgentPush({ roomId: omnis.id, userId: A.id, kind: "answer", text: "끈 방" })
  check("옴니스 방을 끄면 답 푸시도 멈춘다", (await take()).length === 0)
  const cOmnis = await prisma.chatRoom.create({ data: { name: "C 대화", kind: "OMNIS_DM", createdById: C.id, members: { create: [{ userId: C.id }] } }, select: { id: true } })
  made.rooms.push(cOmnis.id)
  await dispatchAgentPush({ roomId: cOmnis.id, userId: C.id, kind: "answer", text: "채팅 끈 사람" })
  check("채팅 알림을 끈 C 에게는 옴니스 답 푸시도 가지 않는다", (await take()).length === 0)

  // ─── 5. 업무 지정 ───
  console.log("\n[5] 업무 지정 — 자기 지정 · 중복 · 이미 담당 · 업무 알림 끔")
  // 담당 {B, D} → {A(자기), B, B, D, G} : 새로 된 사람은 G 뿐(A 는 자기 자신)
  const r1 = await updateTask(task.id, A.id, { assigneeIds: [A.id, B.id, B.id, D.id, G.id] })
  check("updateTask 저장 성공", !("error" in r1), r1)
  lines = (await take()).filter((l) => l.category === "task")
  check(`화면 · MCP update_task 경로: G 한 명만 — 실제 ${names(ids(lines))}`, lines.length === 1 && lines[0].userId === G.id, lines)
  check("G 의 벨에 task_assigned(수락 대기) 한 건", (await prisma.notification.count({ where: { userId: G.id, type: "task_assigned", entityId: task.id } })) === 1)
  const r2 = await updateTask(task.id, A.id, { assigneeIds: [G.id, D.id, B.id, A.id] })
  check("순서만 바꾸면 아무도 받지 않는다", !("error" in r2) && (await take()).filter((l) => l.category === "task").length === 0)
  await updateTask(task.id, A.id, { assigneeIds: [A.id, B.id, D.id, G.id, E.id] })
  lines = (await take()).filter((l) => l.category === "task")
  check("업무 알림을 끈 E — 푸시는 막히고(pref_off) 벨 행은 남는다", lines.length === 1 && lines[0].userId === E.id && lines[0].outcome === "pref_off", lines)
  check("E 의 벨에 task_assigned 가 있다", (await prisma.notification.count({ where: { userId: E.id, type: "task_assigned", entityId: task.id } })) === 1)

  const caller = await callerFor(A.id)
  const mcp = await runTool("create_task", { name: `MCP 업무 ${TAG}`, assignees: [A.name, B.name, B.name, F.name], instruction: "MCP 로 지시" }, caller)
  check("MCP create_task 성공", !("error" in mcp), mcp)
  const mcpTask = await prisma.task.findFirst({ where: { name: `MCP 업무 ${TAG}` }, select: { id: true } })
  if (mcpTask) made.tasks.push(mcpTask.id)
  lines = await take()
  const mcpTaskLines = lines.filter((l) => l.category === "task")
  check(`MCP · 에이전트 create_task: {B, F} 한 번씩 (A 자기 제외) — 실제 ${names(ids(mcpTaskLines))}`, mcpTaskLines.length === 2 && eqSet(ids(mcpTaskLines), [B.id, F.id]), mcpTaskLines)
  check("지시 원문 · 업무 카드는 채팅 푸시를 내지 않는다(task_assigned 와 겹친다)", lines.filter((l) => l.category === "chat").length === 0)

  // ─── 6. 일정 ───
  console.log("\n[6] 일정 — 첫 동기화 제외 · 마스터만 · audience")
  const cal = await prisma.externalCalendar.create({
    data: { provider: "verify", externalId: TAG, href: `/verify/${TAG}/`, displayName: "시험 캘린더", audience: "ALL" },
  })
  made.calendars.push(cal.id)
  const ics = (uid: string, start: string, extra = "") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART;TZID=Asia/Seoul:${start}\r\nDTEND;TZID=Asia/Seoul:${start.slice(0, 9)}235900\r\nSUMMARY:${uid} 회의\r\nORGANIZER:mailto:${TAG}.F@verify.local\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`
  const future = new Date(Date.now() + 7 * 86400_000).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).slice(0, 10).replace(/-/g, "")
  const first = await upsertResources(cal.id, [{ href: `/verify/${TAG}/old.ics`, etag: "1", data: ics(`${TAG}-old`, `${future}T100000`) }])
  const firstOut = await notifyNewCalendarEvents([{ calendar: { id: cal.id, displayName: cal.displayName, audience: "ALL" }, created: first, firstSync: true }])
  await take()
  check("첫 동기화: 행은 생기지만 알림 0", first.length === 1 && firstOut.length === 0 && (await prisma.notification.count({ where: { type: "calendar_event_added", userId: { in: made.users } } })) === 0)

  const weekly = `RRULE:FREQ=WEEKLY;COUNT=10\r\n`
  const second = await upsertResources(cal.id, [
    { href: `/verify/${TAG}/old.ics`, etag: "2", data: ics(`${TAG}-old`, `${future}T110000`) },
    { href: `/verify/${TAG}/new.ics`, etag: "1", data: ics(`${TAG}-new`, `${future}T140000`, weekly) },
  ])
  check("두 번째 동기화: 새로 생긴 행은 새 일정 하나(있던 일정 고침은 새 행이 아니다)", second.length === 1 && second[0].summary === `${TAG}-new 회의`, second.map((s) => s.summary))
  const out = await notifyNewCalendarEvents([{ calendar: { id: cal.id, displayName: cal.displayName, audience: "ALL" }, created: second, firstSync: false }])
  lines = (await take()).filter((l) => l.category === "calendar")
  const calExpected = [...active].filter((id) => ![F.id, SYSTEM_USER_ID].includes(id))
  check(`audience ALL: 활성 전원 − 주최자 F = ${calExpected.length}명`, eqSet(ids(lines), calExpected) && out[0]?.notices === 1, { got: ids(lines).size, out })
  const bell = await prisma.notification.findFirst({ where: { userId: A.id, type: "calendar_event_added" }, select: { title: true, content: true, entityId: true } })
  check("벨에도 남는다 · 누르면 그 날짜(entityId = YYYY-MM-DD:<id>) · 반복 표시", !!bell && bell.title === `새 일정: ${TAG}-new 회의` && bell.entityId?.startsWith(`${future.slice(0, 4)}-${future.slice(4, 6)}-${future.slice(6, 8)}:`) === true && (bell.content ?? "").endsWith("· 반복"), bell)
  check("푸시 주소 /calendar?day=", lines.every((l) => l.url?.startsWith(`/calendar?day=${future.slice(0, 4)}-${future.slice(4, 6)}-${future.slice(6, 8)}`)))

  await prisma.externalCalendar.update({ where: { id: cal.id }, data: { audience: "ADMIN" } })
  const third = await upsertResources(cal.id, [{ href: `/verify/${TAG}/adm.ics`, etag: "1", data: ics(`${TAG}-adm`, `${future}T160000`) }])
  await notifyNewCalendarEvents([{ calendar: { id: cal.id, displayName: cal.displayName, audience: "ADMIN" }, created: third, firstSync: false }])
  lines = (await take()).filter((l) => l.category === "calendar")
  const admins = (await prisma.user.findMany({ where: { isActive: true, role: "ADMIN", id: { not: SYSTEM_USER_ID } }, select: { id: true } })).map((u) => u.id)
  check(`audience ADMIN: 관리자 ${admins.length}명만(시험 A 포함, B~G 제외)`, eqSet(ids(lines), admins) && ids(lines).has(A.id) && !ids(lines).has(B.id))
  const offCal = await prisma.notificationPref.upsert({ where: { userId: A.id }, create: { userId: A.id, calendarPush: false }, update: { calendarPush: false } })
  const fourth = await upsertResources(cal.id, [{ href: `/verify/${TAG}/adm2.ics`, etag: "1", data: ics(`${TAG}-adm2`, `${future}T170000`) }])
  await notifyNewCalendarEvents([{ calendar: { id: cal.id, displayName: cal.displayName, audience: "ADMIN" }, created: fourth, firstSync: false }])
  lines = (await take()).filter((l) => l.userId === A.id)
  check("일정 알림을 끈 A — 푸시만 막히고(pref_off) 벨은 남는다", !!offCal && lines.length === 1 && lines[0].outcome === "pref_off" && (await prisma.notification.count({ where: { userId: A.id, type: "calendar_event_added" } })) === 3, lines)
}

async function cleanup() {
  await settleAfterResponse()
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } })
  await prisma.chatMessage.deleteMany({ where: { OR: [{ roomId: { in: made.rooms } }, { taskId: { in: made.tasks } }] } })
  await prisma.chatRoom.deleteMany({ where: { id: { in: made.rooms } } })
  await prisma.taskEvent.deleteMany({ where: { taskId: { in: made.tasks } } }).catch(() => {})
  await prisma.activityLog.deleteMany({ where: { userId: { in: made.users } } }).catch(() => {})
  await prisma.task.deleteMany({ where: { id: { in: made.tasks } } })
  await prisma.externalCalendar.deleteMany({ where: { id: { in: made.calendars } } })
  await prisma.user.deleteMany({ where: { id: { in: made.users } } })
}

main()
  .catch((e) => {
    console.error(e)
    failed++
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("[정리 실패]", e))
    console.log(`\n${passed} 통과 · ${failed} 실패`)
    await prisma.$disconnect()
    process.exit(failed ? 1 : 0)
  })
