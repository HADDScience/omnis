/**
 * 메신저 목록의 폴더 · 즐겨찾기 · 안 읽음 · 검색 HTTP 검증 — 거부되어야 하는 요청이 실제로 거부되는가,
 * 안 읽은 수의 SQL 이 규칙 정본(lib/chat-list.ts countsAsUnread)과 같은 답을 내는가. 모델을 부르지 않는다(비용 0).
 *
 *   BASE=http://localhost:3102 pnpm exec tsx --env-file=.env scripts/verify-chat-folders.ts
 *
 * dev 서버가 떠 있어야 한다. 로컬 NEXTAUTH_SECRET 으로 두 사람의 세션 쿠키를 만든다.
 * 시험 글 · 방은 DB 에 직접 넣는다(전사방 글쓰기 API 는 색인 · 재구성으로 모델을 부를 수 있다).
 * 끝나면 시험 글 · 방 · 폴더를 지우고 두 사람의 방 설정을 시작 전 값으로 되돌린다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { getSystemUserId } from "../lib/system-user"
import { COMPANY_ROOM_ID } from "../lib/chat-rooms"
import { countsAsUnread, effectiveReadAt, READ_BASELINE_KEY } from "../lib/chat-list"

const BASE = process.env.BASE ?? "http://localhost:3102"
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function cookieFor(user: { id: string; name: string; role: string }) {
  const token = await encode({
    token: { sub: user.id, id: user.id, role: user.role, name: user.name },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 600,
  })
  return `authjs.session-token=${token}`
}

async function call(cookie: string | null, path: string, init: RequestInit & { json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const text = await res.text()
  // 응답 모양은 검사마다 다르다 — 이 시험 스크립트에서만 느슨하게 읽는다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    // 화면 응답
  }
  return { status: res.status, json }
}

type Item = { id: string; key: string; kind: string; name: string; unread: number; favorite: boolean; slug?: string }
type List = { omnis: Item[]; company: Item[]; tasks: Item[]; groups: Item[]; folders: { id: string; name: string; rule: string | null; roomKeys: string[] }[] }
const flat = (l: List) => [...l.omnis, ...l.company, ...l.tasks, ...l.groups]

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!host.startsWith("localhost")) throw new Error(`로컬 DB 가 아니다 (${host}) — 중단`)
  console.log(`대상 DB: ${host} · 서버: ${BASE}`)

  const [a, b] = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true, role: true } })
  const A = await cookieFor(a)
  const B = await cookieFor(b)
  const systemId = await getSystemUserId()
  console.log(`A=${a.name} · B=${b.name}`)

  // 되돌릴 것 — 두 사람의 방 설정 · 폴더
  const prefsBefore = await prisma.chatRoomPref.findMany({ where: { userId: { in: [a.id, b.id] } } })
  const foldersBefore = new Set((await prisma.chatFolder.findMany({ where: { userId: { in: [a.id, b.id] } }, select: { id: true } })).map((f) => f.id))
  const createdMessages: string[] = []

  const dmB = await prisma.chatRoom.create({
    data: { name: "B 의 비밀 대화 zq9", kind: "OMNIS_DM", createdById: b.id, lastMessageAt: new Date(), members: { create: { userId: b.id } } },
  })
  const dmA = await prisma.chatRoom.create({
    data: { name: "A 의 시험 대화", kind: "OMNIS_DM", createdById: a.id, lastMessageAt: new Date(), members: { create: { userId: a.id } } },
  })
  const task = await prisma.task.findFirst({
    where: { archived: false, messages: { some: { room: { kind: "COMPANY" }, deletedAt: null } } },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, slug: true },
  })
  if (!task) throw new Error("업무 스레드가 있는 업무가 없다")

  const post = async (data: { roomId: string; authorId: string; content: string; taskId?: string; deletedAt?: Date }) => {
    const m = await prisma.chatMessage.create({ data })
    createdMessages.push(m.id)
    return m
  }
  const listA = async (q?: string) => (await call(A, `/api/chat/rooms${q ? `?q=${encodeURIComponent(q)}` : ""}`)).json as List
  const unreadOf = (l: List, key: string) => flat(l).find((r) => r.key === key)?.unread

  try {
    console.log("\n[1] 목록 응답")
    const l0 = await listA()
    check("방마다 key · unread · favorite 가 있다", flat(l0).every((r) => typeof r.key === "string" && typeof r.unread === "number" && typeof r.favorite === "boolean"))
    check("폴더 목록이 온다", Array.isArray(l0.folders))
    check("안 읽음 기준 줄이 생겼다", !!(await prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId: a.id, roomKey: READ_BASELINE_KEY } } })))
    check("A 목록에 B 의 1:1 방이 없다 (거부되어야 하는 경우)", !flat(l0).some((r) => r.id === dmB.id))
    check("로그인 없이 401", (await call(null, "/api/chat/rooms")).status === 401 && (await call(null, "/api/chat/folders")).status === 401)

    console.log("\n[2] 즐겨찾기")
    const companyKey = `room:${COMPANY_ROOM_ID}`
    check("전사방 즐겨찾기 켜기 200", (await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: companyKey, favorite: true } })).status === 200)
    check("목록에 favorite=true", flat(await listA()).find((r) => r.key === companyKey)?.favorite === true)
    await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: companyKey, favorite: false } })
    check("끄면 favorite=false", flat(await listA()).find((r) => r.key === companyKey)?.favorite === false)
    check("바꿀 것 없는 요청 400", (await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: companyKey } })).status === 400)

    console.log("\n[3] 폴더")
    const f1 = await call(A, "/api/chat/folders", { method: "POST", json: { name: "시험 폴더" } })
    check("수동 폴더 만들기 201", f1.status === 201 && f1.json.rule === null, f1)
    await call(A, "/api/chat/folders", { method: "POST", json: { name: "시험 폴더 2" } }) // 순서 바꾸기에 쓸 두 번째 폴더
    const fid = f1.json.id as string
    const taskKey = `task:${task.id}`
    check("업무방 넣기 201", (await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: taskKey } })).status === 201)
    check("내 1:1 방 넣기 201", (await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: `room:${dmA.id}` } })).status === 201)
    check("같은 방 두 번 넣어도 한 줄", (await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: taskKey } })).status === 201)
    let l = await listA()
    const f = l.folders.find((x) => x.id === fid)
    check("목록의 폴더에 두 방", f?.roomKeys.length === 2 && f.roomKeys.includes(taskKey), f)
    check("이름 바꾸기 200", (await call(A, `/api/chat/folders/${fid}`, { method: "PATCH", json: { name: "  견적 모음  " } })).status === 200)
    check("빈 이름은 400", (await call(A, `/api/chat/folders/${fid}`, { method: "PATCH", json: { name: "   " } })).status === 400)
    check("21자 이름은 400", (await call(A, "/api/chat/folders", { method: "POST", json: { name: "가".repeat(21) } })).status === 400)
    const mine = (await listA()).folders.map((x) => x.id)
    const reversed = [...mine].reverse()
    check("순서 바꾸기 200", (await call(A, "/api/chat/folders", { method: "PATCH", json: { order: reversed } })).status === 200)
    l = await listA()
    check("바뀐 순서로 온다", JSON.stringify(l.folders.map((x) => x.id)) === JSON.stringify(reversed))
    check("이름이 다듬어져 저장", l.folders.find((x) => x.id === fid)?.name === "견적 모음")
    check("빼기 200", (await call(A, `/api/chat/folders/${fid}/rooms?roomKey=${encodeURIComponent(`room:${dmA.id}`)}`, { method: "DELETE" })).status === 200)
    check("빼면 한 방", (await listA()).folders.find((x) => x.id === fid)?.roomKeys.length === 1)

    console.log("\n[4] 추천(규칙) 폴더")
    const hadTaskRule = (await listA()).folders.some((x) => x.rule === "TASK")
    const r1 = hadTaskRule ? { status: 201, json: (await listA()).folders.find((x) => x.rule === "TASK") } : await call(A, "/api/chat/folders", { method: "POST", json: { rule: "TASK" } })
    check("「업무방」 추가", r1.status === 201 && r1.json?.name === "업무방", r1)
    check("두 번째 「업무방」 은 409 (거부되어야 하는 경우)", (await call(A, "/api/chat/folders", { method: "POST", json: { rule: "TASK" } })).status === 409)
    check("없는 규칙은 400", (await call(A, "/api/chat/folders", { method: "POST", json: { rule: "OMNIS_DM" } })).status === 400)
    check("규칙 폴더에 방을 직접 넣으면 400", (await call(A, `/api/chat/folders/${r1.json.id}/rooms`, { method: "POST", json: { roomKey: companyKey } })).status === 400)

    console.log("\n[5] 남의 방 · 남의 폴더 (모두 거부되어야 하는 경우)")
    const dmBKey = `room:${dmB.id}`
    const addB = await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: dmBKey } })
    check("B 의 1:1 방을 A 폴더에 넣으면 404", addB.status === 404, addB)
    check("…없는 방과 같은 답(404)", (await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: "room:no-such-room" } })).status === 404)
    check("B 의 1:1 방 즐겨찾기 404", (await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: dmBKey, favorite: true } })).status === 404)
    check("B 의 1:1 방 읽음 404", (await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: dmBKey, read: true } })).status === 404)
    check("B 의 방 설정 행이 생기지 않았다", !(await prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId: a.id, roomKey: dmBKey } } })))
    check("B 의 방이 A 폴더에 들어가지 않았다", !(await prisma.chatFolderRoom.findFirst({ where: { roomKey: dmBKey } })))
    check("기준 줄 키 `*` 는 400", (await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: "*", read: true } })).status === 400)
    check("모르는 접두사 400", (await call(A, `/api/chat/folders/${fid}/rooms`, { method: "POST", json: { roomKey: `user:${b.id}` } })).status === 400)
    const fb = await call(B, "/api/chat/folders", { method: "POST", json: { name: "B 폴더" } })
    const fbId = fb.json.id as string
    check("A 가 B 폴더 이름 바꾸면 404", (await call(A, `/api/chat/folders/${fbId}`, { method: "PATCH", json: { name: "가로채기" } })).status === 404)
    check("A 가 B 폴더에 방 넣으면 404", (await call(A, `/api/chat/folders/${fbId}/rooms`, { method: "POST", json: { roomKey: companyKey } })).status === 404)
    check("A 가 B 폴더 지우면 404", (await call(A, `/api/chat/folders/${fbId}`, { method: "DELETE" })).status === 404)
    check("A 순서에 B 폴더를 섞으면 400", (await call(A, "/api/chat/folders", { method: "PATCH", json: { order: [...reversed, fbId] } })).status === 400)
    check("B 폴더는 그대로", (await prisma.chatFolder.findUnique({ where: { id: fbId } }))?.name === "B 폴더")
    check("A 목록에 B 폴더가 없다", !(await listA()).folders.some((x) => x.id === fbId))
    check("B 목록에 A 폴더가 없다", !((await call(B, "/api/chat/rooms")).json as List).folders.some((x) => x.id === fid))

    console.log("\n[6] 안 읽음")
    await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: companyKey, read: true } })
    await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: taskKey, read: true } })
    await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: `room:${dmA.id}`, read: true } })
    l = await listA()
    check("읽은 직후 전사방 0", unreadOf(l, companyKey) === 0, unreadOf(l, companyKey))
    await sleep(20)
    await post({ roomId: COMPANY_ROOM_ID, authorId: b.id, content: "[시험] B 가 전사방에 쓴 글" })
    check("B 가 쓰면 전사방 1", unreadOf(await listA(), companyKey) === 1)
    await post({ roomId: COMPANY_ROOM_ID, authorId: a.id, content: "[시험] A 자기 글" })
    await post({ roomId: COMPANY_ROOM_ID, authorId: systemId, content: "🤖 [시험] 시스템 글" })
    await post({ roomId: COMPANY_ROOM_ID, authorId: b.id, content: "[시험] 지운 글", deletedAt: new Date() })
    check("내 글 · 시스템 글 · 지운 글은 늘지 않는다 (거부되어야 하는 경우)", unreadOf(await listA(), companyKey) === 1)
    await post({ roomId: COMPANY_ROOM_ID, authorId: b.id, content: "[시험] B 업무 스레드 글", taskId: task.id })
    l = await listA()
    check("업무 스레드 글 — 업무방 1", unreadOf(l, taskKey) === 1, unreadOf(l, taskKey))
    check("…전사방도 2(전사방 화면에 같은 글이 보인다)", unreadOf(l, companyKey) === 2, unreadOf(l, companyKey))
    await post({ roomId: dmA.id, authorId: systemId, content: "옴니스 답 [시험]" })
    check("옴니스 1:1 방 — 옴니스 답은 센다", unreadOf(await listA(), `room:${dmA.id}`) === 1)

    // SQL 과 규칙 정본이 같은 답을 내는가 — 전사방
    const pref = await prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId: a.id, roomKey: companyKey } } })
    const baseline = (await prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId: a.id, roomKey: READ_BASELINE_KEY } } }))!.lastReadAt!
    const readAt = effectiveReadAt(pref?.lastReadAt, baseline)
    const since = await prisma.chatMessage.findMany({ where: { roomId: COMPANY_ROOM_ID, createdAt: { gt: readAt } }, select: { authorId: true, createdAt: true, deletedAt: true } })
    const byRule = since.filter((m) => countsAsUnread(m, { userId: a.id, systemUserId: systemId, roomKind: "COMPANY", readAt })).length
    check(`SQL(${unreadOf(l, companyKey)}) = 규칙 정본(${byRule}) — 읽은 뒤 글 ${since.length}개 중`, unreadOf(l, companyKey) === byRule)

    await call(A, "/api/chat/prefs", { method: "PATCH", json: { roomKey: companyKey, read: true } })
    l = await listA()
    check("열면(read) 전사방 0", unreadOf(l, companyKey) === 0)
    check("…업무방은 따로라 그대로 1", unreadOf(l, taskKey) === 1)

    console.log("\n[7] 검색")
    const s1 = await listA(task.slug)
    check(`슬러그 「${task.slug}」 로 그 업무방`, s1.tasks.some((r) => r.id === task.id))
    check("#슬러그 로도", (await listA(`#${task.slug}`)).tasks.some((r) => r.id === task.id))
    check("업무 이름 일부로", (await listA(task.name.slice(0, Math.min(4, task.name.length)))).tasks.some((r) => r.id === task.id))
    check("마지막 글 미리보기로(「옴니스 답 [시험]」)", (await listA("옴니스 답 [시험")).omnis.some((r) => r.id === dmA.id))
    check("방 이름으로 전사방", (await listA("하드사이언스")).company.some((r) => r.id === COMPANY_ROOM_ID))
    const none = await listA("없는말zzqx")
    check("없는 말은 0건", flat(none).length === 0)
    check("B 의 1:1 방 이름으로 찾아도 안 나온다 (거부되어야 하는 경우)", flat(await listA("비밀 대화 zq9")).length === 0)
    check("`%` 는 모든 방이 아니라 글자로", flat(await listA("%")).length < flat(l).length)
  } finally {
    await prisma.chatMessage.deleteMany({ where: { id: { in: createdMessages } } })
    await prisma.chatRoom.deleteMany({ where: { id: { in: [dmA.id, dmB.id] } } })
    await prisma.chatFolder.deleteMany({ where: { userId: { in: [a.id, b.id] }, id: { notIn: [...foldersBefore] } } })
    await prisma.chatRoomPref.deleteMany({ where: { userId: { in: [a.id, b.id] } } })
    if (prefsBefore.length) await prisma.chatRoomPref.createMany({ data: prefsBefore })
    await prisma.$disconnect()
  }

  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과")
  process.exit(failed ? 1 : 0)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
