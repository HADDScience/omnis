/**
 * 사람끼리 대화(5단계) HTTP 검증 — 1:1 · 단톡방이 열리고, 참여자 밖으로 내용이 새지 않는가. 모델을 부르지 않는다(비용 0).
 *
 *   BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-people-rooms.ts
 *
 * dev 서버가 떠 있어야 한다. 로컬 NEXTAUTH_SECRET 으로 세 사람(A · B · C)의 세션 쿠키를 만든다.
 * 만든 방 · 글 · 알림은 끝에 지운다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { readChatFeed } from "../lib/chat-feed"
import { syncEmbeddings } from "../lib/embeddings"
import { listRooms } from "../lib/chat-rooms"
import { dmKeyOf } from "../lib/chat-people-rules"

const BASE = process.env.BASE ?? "http://localhost:3103"
const TAG = `people-${Date.now().toString(36)}`
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

type U = { id: string; name: string; role: string }
async function cookieFor(user: U) {
  const token = await encode({
    token: { sub: user.id, id: user.id, role: user.role, name: user.name },
    secret: process.env.NEXTAUTH_SECRET!,
    salt: "authjs.session-token",
    maxAge: 600,
  })
  return `authjs.session-token=${token}`
}

async function call(cookie: string | null, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json", ...(init.headers ?? {}) },
  })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try {
    json = JSON.parse(text)
  } catch {
    // 화면(HTML)
  }
  return { status: res.status, json, text }
}
const post = (c: string | null, p: string, body: unknown) => call(c, p, { method: "POST", body: JSON.stringify(body) })

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!host.startsWith("localhost")) throw new Error(`로컬 DB 가 아니다 (${host}) — 중단`)
  console.log(`대상 DB: ${host} · 서버: ${BASE}`)

  const [a, b, c] = await prisma.user.findMany({
    where: { isActive: true, id: { not: "system" } },
    orderBy: { name: "asc" },
    take: 3,
    select: { id: true, name: true, role: true },
  })
  const [A, B, C] = await Promise.all([cookieFor(a), cookieFor(b), cookieFor(c)])
  console.log(`A=${a.name} · B=${b.name} · C=${c.name}`)

  // 이 시험 전에 A·B 의 1:1 이 이미 있으면 그 방을 쓴다(지우지 않는다)
  const preexisting = await prisma.chatRoom.findUnique({ where: { dmKey: dmKeyOf(a.id, b.id) }, select: { id: true } })
  const made: string[] = []
  const secret = `${TAG} 둘만 아는 내용`

  try {
    console.log("[1] 1:1 — 같은 두 사람은 한 방")
    const dm1 = await post(A, "/api/chat/people-rooms", { userIds: [b.id] })
    check("A 가 B 를 고르면 1:1 이 열린다", (dm1.status === 201 || dm1.status === 200) && dm1.json?.kind === "DM", dm1)
    const dmId = String(dm1.json?.roomId)
    if (!preexisting) made.push(dmId)
    const dm2 = await post(A, "/api/chat/people-rooms", { userIds: [b.id] })
    check("다시 고르면 같은 방(200 · existing)", dm2.status === 200 && dm2.json?.roomId === dmId && dm2.json?.existing === true, dm2)
    const dm3 = await post(B, "/api/chat/people-rooms", { userIds: [a.id] })
    check("B 가 A 를 골라도 같은 방", dm3.json?.roomId === dmId, dm3)
    const [r1, r2] = await Promise.all([
      post(A, "/api/chat/people-rooms", { userIds: [c.id] }),
      post(C, "/api/chat/people-rooms", { userIds: [a.id] }),
    ])
    const acKey = dmKeyOf(a.id, c.id)
    const acRooms = await prisma.chatRoom.count({ where: { dmKey: acKey } })
    check("동시에 서로를 골라도 1:1 방은 하나", acRooms === 1 && r1.json?.roomId === r2.json?.roomId, { acRooms, r1: r1.json, r2: r2.json })
    const acId = String(r1.json?.roomId)
    if (r1.status === 201 || r2.status === 201) made.push(acId)

    console.log("[2] 거부되어야 하는 만들기")
    check("나만 고르면 400", (await post(A, "/api/chat/people-rooms", { userIds: [a.id] })).status === 400)
    check("시스템 계정은 고를 수 없다 400", (await post(A, "/api/chat/people-rooms", { userIds: ["system"] })).status === 400)
    check("없는 사람 400", (await post(A, "/api/chat/people-rooms", { userIds: ["no-such-user"] })).status === 400)
    check("로그인 없이 401", (await post(null, "/api/chat/people-rooms", { userIds: [b.id] })).status === 401)

    console.log("[3] 1:1 글 · 참여자 밖")
    const sent = await post(A, "/api/chat/messages", { roomId: dmId, content: `${secret} @${b.name} @${c.name}` })
    check("A 가 1:1 에 쓴다 201", sent.status === 201, sent)
    const msgId = String(sent.json?.id)
    check("B 는 메시지 API 로 읽는다", (await call(B, `/api/chat/messages?roomId=${dmId}`)).text.includes(secret))
    const cRead = await call(C, `/api/chat/messages?roomId=${dmId}`)
    check("C 는 메시지 API 403 · 내용 없음 (거부되어야 하는 경우)", cRead.status === 403 && !cRead.text.includes(secret), cRead.status)
    const cSearch = await call(C, `/api/chat/search?roomId=${dmId}&q=${encodeURIComponent(TAG)}`)
    check("C 는 검색 API 403 (거부되어야 하는 경우)", cSearch.status === 403 && !cSearch.text.includes(secret), cSearch.status)
    const cPost = await post(C, "/api/chat/messages", { roomId: dmId, content: "끼어들기" })
    check("C 는 글을 못 쓴다 404 (거부되어야 하는 경우)", cPost.status === 404, cPost.status)
    const cPage = await call(C, `/chat/${dmId}`)
    check("C 가 방 주소를 열면 404 · 내용 없음 (거부되어야 하는 경우)", cPage.text.includes("NEXT_HTTP_ERROR_FALLBACK;404") && !cPage.text.includes(secret))
    const bPage = await call(B, `/chat/${dmId}`)
    check("B 는 방 주소를 연다 — 글이 보인다", bPage.status === 200 && bPage.text.includes(secret))
    const cInfo = await call(C, `/api/chat/people-rooms/${dmId}`)
    check("C 는 방 정보 404", cInfo.status === 404)
    const cList = await listRooms(c.id)
    check("C 의 목록에 A·B 의 1:1 이 없다", ![...cList.groups, ...cList.omnis].some((r) => r.id === dmId))
    const bList = await listRooms(b.id)
    const bRow = bList.groups.find((r) => r.id === dmId)
    check("B 의 목록에 1:1 이 상대(A) 이름으로", bRow?.name === a.name && bRow?.kind === "DM", bRow)
    check("B 의 목록에 안 읽은 글 1", (bRow?.unread ?? 0) >= 1, bRow?.unread)
    const cSearchList = await listRooms(c.id, { q: TAG })
    check("C 의 목록 검색에도 없다", ![...cSearchList.groups].some((r) => r.id === dmId))
    const files = await post(A, "/api/chat/messages", { roomId: dmId, content: "파일", fileIds: ["x"] })
    check("첨부는 400 — 파일 목록이 방을 가리지 않는다", files.status === 400)
    const companyMsg = await prisma.chatMessage.findFirst({ where: { roomId: "default-room", deletedAt: null }, select: { id: true } })
    if (companyMsg) {
      const crossReply = await post(A, "/api/chat/messages", { roomId: dmId, content: `${TAG} 답장`, replyToId: companyMsg.id })
      check("다른 방 글에 답장으로 걸면 인용을 붙이지 않는다", crossReply.status === 201 && crossReply.json?.replyTo === null, crossReply.json?.replyTo)
    }
    const leakToCompany = await post(A, "/api/chat/messages", { roomId: "default-room", content: `${TAG} 인용 시도`, replyToId: msgId })
    check("전사방 글에 1:1 글을 답장으로 걸면 400 — 인용으로 새지 않는다 (거부되어야 하는 경우)", leakToCompany.status === 400, leakToCompany.status)

    console.log("[4] 방을 가리지 않는 읽기에 새지 않는다")
    const feed = await readChatFeed({ currentUserId: a.id, view: "all", take: 200 })
    check("피드 view=all 에 1:1 글이 없다", "messages" in feed && !feed.messages.some((m) => m.id === msgId))
    await syncEmbeddings("CHAT_MESSAGE", msgId, a.id)
    const chunks = await prisma.embeddingChunk.count({ where: { source: "CHAT_MESSAGE", sourceId: msgId } })
    check("사내 지식 색인에 넣지 않는다(직접 동기화를 불러도 0)", chunks === 0, chunks)
    const mentions = await prisma.chatMention.count({ where: { messageId: msgId } })
    check("멘션 표(ChatMention)를 남기지 않는다", mentions === 0, mentions)

    console.log("[5] 멘션 알림은 참여자에게만")
    const nb = await prisma.notification.count({ where: { userId: b.id, type: "chat_mention", entityId: dmId, createdAt: { gte: new Date(Date.now() - 60_000) } } })
    const nc = await prisma.notification.count({ where: { userId: c.id, type: "chat_mention", entityId: dmId } })
    check("B(참여자)에게 알림", nb >= 1, nb)
    check("C(방 밖)에게는 이름을 불러도 알림이 없다 (거부되어야 하는 경우)", nc === 0, nc)

    console.log("[6] 단톡방 — 만들기 · 이름 · 초대 · 나가기")
    const g = await post(A, "/api/chat/people-rooms", { userIds: [b.id, c.id] })
    check("두 명을 고르면 단톡방 201", g.status === 201 && g.json?.kind === "GROUP", g)
    const gId = String(g.json?.roomId)
    made.push(gId)
    const gRoom = await prisma.chatRoom.findUnique({ where: { id: gId }, select: { name: true, _count: { select: { members: true } } } })
    check("기본 이름은 참여자 이름을 잇는다(나는 맨 뒤)", gRoom?.name === `${b.name}, ${c.name}, ${a.name}`, gRoom?.name)
    check("참여자 3명", gRoom?._count.members === 3)
    const g2 = await post(A, "/api/chat/people-rooms", { userIds: [b.id, c.id] })
    made.push(String(g2.json?.roomId))
    check("같은 사람으로 다시 만들면 새 단톡방(1:1 과 다르다)", g2.status === 201 && g2.json?.roomId !== gId)
    const named = await post(A, "/api/chat/people-rooms", { userIds: [b.id, c.id], name: `${TAG} 견적팀` })
    made.push(String(named.json?.roomId))
    check("이름을 주면 그 이름", (await prisma.chatRoom.findUnique({ where: { id: String(named.json?.roomId) }, select: { name: true } }))?.name === `${TAG} 견적팀`)
    const ren = await call(B, `/api/chat/people-rooms/${gId}`, { method: "PATCH", body: JSON.stringify({ name: `${TAG} 새 이름` }) })
    check("참여자(B)는 이름을 바꾼다", ren.status === 200)
    check("1:1 은 이름을 못 바꾼다 400", (await call(A, `/api/chat/people-rooms/${dmId}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status === 400)
    check("1:1 에는 초대할 수 없다 400", (await post(A, `/api/chat/people-rooms/${dmId}/members`, { userIds: [c.id] })).status === 400)
    check("1:1 은 나갈 수 없다 400", (await call(A, `/api/chat/people-rooms/${dmId}/members`, { method: "DELETE" })).status === 400)

    // C 를 빼고 A·B 만 있는 단톡방에서 초대 · 나가기
    const ab = await prisma.chatRoom.create({
      data: { kind: "GROUP", name: `${TAG} 둘이서`, createdById: a.id, members: { create: [{ userId: a.id }, { userId: b.id }] } },
    })
    made.push(ab.id)
    await post(A, "/api/chat/messages", { roomId: ab.id, content: `${TAG} 초대 전 글` })
    check("방 밖 C 는 초대할 수 없다 404 (거부되어야 하는 경우)", (await post(C, `/api/chat/people-rooms/${ab.id}/members`, { userIds: [c.id] })).status === 404)
    check("방 밖 C 는 이름을 못 바꾼다 404", (await call(C, `/api/chat/people-rooms/${ab.id}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) })).status === 404)
    check("방 밖 C 는 나가기도 404", (await call(C, `/api/chat/people-rooms/${ab.id}/members`, { method: "DELETE" })).status === 404)
    const inv = await post(B, `/api/chat/people-rooms/${ab.id}/members`, { userIds: [c.id, a.id] })
    check("B 가 C 를 초대 — 이미 있는 A 는 건너뛴다", inv.status === 200 && inv.json?.added === 1, inv.json)
    check("초대된 C 는 지금까지의 글을 읽는다", (await call(C, `/api/chat/messages?roomId=${ab.id}`)).text.includes("초대 전 글"))
    // C 가 폴더 · 즐겨찾기에 넣은 뒤 나간다 — 나간 뒤 남지 않아야 한다
    const folder = await prisma.chatFolder.create({ data: { userId: c.id, name: `${TAG} 폴더`, rooms: { create: { roomKey: `room:${ab.id}` } } } })
    await prisma.chatRoomPref.create({ data: { userId: c.id, roomKey: `room:${ab.id}`, favorite: true } })
    const left = await call(C, `/api/chat/people-rooms/${ab.id}/members`, { method: "DELETE" })
    check("C 가 나간다", left.status === 200)
    check("나간 C 는 메시지 API 403", (await call(C, `/api/chat/messages?roomId=${ab.id}`)).status === 403)
    check("나간 C 는 글을 못 쓴다 404", (await post(C, "/api/chat/messages", { roomId: ab.id, content: "x" })).status === 404)
    check("나간 C 의 목록에 없다", !(await listRooms(c.id)).groups.some((r) => r.id === ab.id))
    check("나간 C 의 즐겨찾기 · 폴더에서 빠졌다",
      (await prisma.chatRoomPref.count({ where: { userId: c.id, roomKey: `room:${ab.id}` } })) === 0 &&
      (await prisma.chatFolderRoom.count({ where: { folderId: folder.id } })) === 0)
    await prisma.chatFolder.delete({ where: { id: folder.id } })
    check("남은 A · B 는 그대로", (await prisma.chatRoomMember.count({ where: { roomId: ab.id } })) === 2)
  } finally {
    const rooms = made.filter(Boolean)
    await prisma.notification.deleteMany({ where: { type: "chat_mention", entityId: { in: [...rooms, ...(preexisting ? [preexisting.id] : [])] }, createdAt: { gte: new Date(Date.now() - 10 * 60_000) } } })
    await prisma.chatMessage.deleteMany({ where: { content: { contains: TAG } } })
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: rooms } } })
    await prisma.chatRoom.deleteMany({ where: { id: { in: rooms } } })
  }

  console.log(failed === 0 ? "전부 통과" : `실패 ${failed}건`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
