/**
 * 옴니스 방 HTTP 검증 — 거부되어야 하는 요청이 실제로 거부되는가. Gemini 를 부르지 않는 경로만 친다(비용 0).
 *
 *   BASE=http://localhost:3102 pnpm exec tsx --env-file=.env scripts/verify-omnis-room-http.ts
 *
 * dev 서버가 떠 있어야 한다. 로컬 AUTH 비밀(NEXTAUTH_SECRET)로 두 사람의 세션 쿠키를 만들고,
 * 시험용 1:1 방(질문 · 답 한 쌍)을 DB 에 직접 만든 뒤 끝에 지운다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { getSystemUserId } from "../lib/system-user"

const BASE = process.env.BASE ?? "http://localhost:3102"
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (!ok) failed++
}

async function cookieFor(user: { id: string; name: string; role: string }) {
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
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // 화면(HTML) 응답
  }
  return { status: res.status, json, text, location: res.headers.get("location") }
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!host.startsWith("localhost")) throw new Error(`로컬 DB 가 아니다 (${host}) — 중단`)
  console.log(`대상 DB: ${host} · 서버: ${BASE}`)

  const [a, b] = await prisma.user.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true, role: true } })
  const A = await cookieFor(a)
  const B = await cookieFor(b)
  console.log(`A=${a.name} · B=${b.name}`)

  const room = await prisma.chatRoom.create({
    data: { name: "HTTP 시험 방", kind: "OMNIS_DM", createdById: a.id, lastMessageAt: new Date(), members: { create: { userId: a.id } } },
  })
  try {
    const q = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: a.id, content: "시험 질문", createdAt: new Date(Date.now() - 2000) } })
    await prisma.chatMessage.create({ data: { roomId: room.id, authorId: await getSystemUserId(), content: "시험 답" } })

    console.log("\n[1] 첫 화면")
    const rootIn = await call(A, "/")
    check("로그인한 / 는 /chat 으로", rootIn.status === 307 && (rootIn.location ?? "").endsWith("/chat"), rootIn)
    const rootOut = await call(null, "/")
    check("로그인 안 한 / 는 랜딩(200)", rootOut.status === 200)
    const chat = await call(A, "/chat")
    check("/chat 은 메신저(200)", chat.status === 200 && chat.text.includes("채팅방 목록"))

    console.log("\n[2] 방 화면")
    // 방 화면은 loading.tsx(스트리밍) 안에서 notFound() 를 부른다 — Next 는 이미 200 을 보낸 뒤라 상태 코드 대신
    // 본문에 404 표식(NEXT_HTTP_ERROR_FALLBACK;404)을 싣는다. 그래서 상태가 아니라 본문으로 판정한다
    const notFound = (r: { status: number; text: string }) => r.status === 404 || r.text.includes("NEXT_HTTP_ERROR_FALLBACK;404")
    const own = await call(A, `/chat/${room.id}`)
    check("A 는 자기 방을 연다 — 글이 보인다", own.status === 200 && own.text.includes("시험 질문") && !notFound(own))
    const other = await call(B, `/chat/${room.id}`)
    check("B 는 A 의 방을 못 연다 — 404 · 글이 없다 (거부되어야 하는 경우)", notFound(other) && !other.text.includes("시험 질문"), other.status)
    check("없는 방은 404", notFound(await call(A, "/chat/no-such-room")))

    console.log("\n[3] 목록 API")
    const listA = (await call(A, "/api/chat/rooms")).json as { omnis: { id: string }[] }
    const listB = (await call(B, "/api/chat/rooms")).json as { omnis: { id: string }[] }
    check("A 의 목록에 있다", listA.omnis.some((r) => r.id === room.id))
    check("B 의 목록에 없다 (거부되어야 하는 경우)", !listB.omnis.some((r) => r.id === room.id))
    check("로그인 없이 401", (await call(null, "/api/chat/rooms")).status === 401)

    console.log("\n[4] 묻기 API — Gemini 앞에서 막히는 경우")
    const askB = await call(B, `/api/chat/rooms/${room.id}/ask`, { method: "POST", body: JSON.stringify({ content: "남의 방에 묻기" }) })
    check("B 가 A 의 방에 물으면 404 (거부되어야 하는 경우)", askB.status === 404, askB.json)
    const short = await call(A, `/api/chat/rooms/${room.id}/ask`, { method: "POST", body: JSON.stringify({ content: "a" }) })
    check("1자는 400", short.status === 400, short.json)
    const long = await call(A, `/api/chat/rooms/${room.id}/ask`, { method: "POST", body: JSON.stringify({ content: "가".repeat(1001) }) })
    check("1001자는 400", long.status === 400, long.json)
    const again = await call(A, `/api/chat/rooms/${room.id}/ask`, { method: "POST", body: JSON.stringify({ retryOf: q.id }) })
    check("이미 답을 받은 글을 다시 물으면 409", again.status === 409, again.json)
    const newShort = await call(A, "/api/chat/rooms", { method: "POST", body: JSON.stringify({ content: " " }) })
    check("새 대화 빈 글은 400 — 방을 만들지 않는다", newShort.status === 400)

    console.log("\n[5] 전사방 API 로 1:1 방을 건드리지 못한다")
    const readB = await call(B, `/api/chat/messages?roomId=${room.id}`)
    check("B 가 메시지 API 로 읽으면 403 (거부되어야 하는 경우)", readB.status === 403, readB.json)
    const readA = await call(A, `/api/chat/messages?roomId=${room.id}`)
    check("A 는 메시지 API 로 읽는다", readA.status === 200 && Array.isArray(readA.json) && (readA.json as unknown[]).length === 2)
    const searchB = await call(B, `/api/chat/search?roomId=${room.id}&q=시험`)
    check("B 가 검색 API 로 찾으면 403", searchB.status === 403)
    const postA = await call(A, "/api/chat/messages", { method: "POST", body: JSON.stringify({ roomId: room.id, content: "패널 길로 쓰기" }) })
    check("1:1 방에 전사방 글쓰기 API 로 쓰면 403", postA.status === 403, postA.json)
    const company = await call(B, "/api/chat/messages?roomId=default-room")
    check("전사방은 그대로 읽힌다", company.status === 200)

    const left = await prisma.chatMessage.count({ where: { roomId: room.id } })
    check("거부된 요청은 글을 남기지 않았다", left === 2, left)
    const strayRooms = await prisma.chatRoom.count({ where: { kind: "OMNIS_DM", createdById: a.id, createdAt: { gte: room.createdAt }, id: { not: room.id } } })
    check("거부된 새 대화는 방을 만들지 않았다", strayRooms === 0, strayRooms)
  } finally {
    await prisma.chatMessage.deleteMany({ where: { roomId: room.id } })
    await prisma.chatRoom.delete({ where: { id: room.id } })
  }

  console.log(failed === 0 ? "\n전부 통과" : `\n실패 ${failed}건`)
  await prisma.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
