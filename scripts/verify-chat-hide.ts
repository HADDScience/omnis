/**
 * 채팅 목록에서 지우기 · 숨기기 · 나가기(2026-10-29) HTTP 검증. 모델을 부르지 않는다(비용 0).
 *
 *   BASE=http://localhost:3103 pnpm exec tsx --env-file=.env scripts/verify-chat-hide.ts
 *
 * 옴니스 1:1 은 글을 직접 넣어 만든다(모델 없이). 만든 방 · 글은 끝에 지운다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { dmKeyOf } from "../lib/chat-people-rules"
import { SYSTEM_USER_ID } from "../lib/system-user"

const BASE = process.env.BASE ?? "http://localhost:3103"
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
const patch = (c: string, body: unknown) => call(c, "/api/chat/prefs", { method: "PATCH", body: JSON.stringify(body) })
type List = { omnis: { key: string }[]; groups: { key: string }[]; company: { key: string }[]; folders: { id: string; roomKeys: string[] }[] }
const listKeys = async (c: string, q?: string) => {
  const r = await call(c, `/api/chat/rooms${q ? `?q=${encodeURIComponent(q)}` : ""}`)
  const d = r.json as unknown as List
  return new Set([...d.omnis, ...d.groups, ...d.company].map((x) => x.key))
}

async function main() {
  const host = (process.env.DATABASE_URL ?? "").replace(/.*@/, "").replace(/\/.*/, "")
  if (!host.startsWith("localhost")) throw new Error(`로컬 DB 가 아니다 (${host}) — 중단`)
  console.log(`대상 DB: ${host} · 서버: ${BASE}`)
  const [a, b] = await prisma.user.findMany({ where: { isActive: true, id: { not: "system" } }, orderBy: { name: "asc" }, take: 2, select: { id: true, name: true, role: true } })
  const A = await cookieFor(a)
  const B = await cookieFor(b)
  console.log(`A=${a.name} · B=${b.name}`)
  const tag = `숨김검증-${Date.now().toString(36)}`
  const made: string[] = []

  try {
    // ─── 옴니스 1:1 — 대화 삭제 ───
    console.log("[1] 옴니스 1:1 — 대화 삭제는 나에게서 숨기고 기록은 남긴다")
    const now = new Date()
    const omnis = await prisma.chatRoom.create({
      data: { name: tag, kind: "OMNIS_DM", createdById: a.id, lastMessageAt: now, members: { create: { userId: a.id } } },
    })
    made.push(omnis.id)
    const q = await prisma.chatMessage.create({ data: { roomId: omnis.id, authorId: a.id, content: `${tag} 질문`, createdAt: now } })
    await prisma.chatMessage.create({ data: { roomId: omnis.id, authorId: SYSTEM_USER_ID, content: `${tag} 답`, createdAt: new Date(now.getTime() + 1000) } })
    const run = await prisma.agentRun.create({ data: { roomId: omnis.id, userId: a.id, questionMessageId: q.id, model: "openai:test", status: "DONE", messages: [] } })
    const usage = await prisma.aiUsage.create({
      data: { vendor: "openai", model: "test", feature: "agent", inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, costUsd: 0, costKrw: 0, userId: a.id, roomId: omnis.id, runId: run.id },
    })
    const key = `room:${omnis.id}`
    check("지우기 전 목록에 있다", (await listKeys(A)).has(key))
    await patch(A, { roomKey: key, favorite: true })
    const r = await patch(A, { roomKey: key, hidden: true })
    check("대화 삭제 200", r.status === 200, r)
    check("목록에서 빠진다", !(await listKeys(A)).has(key))
    check("목록 검색에도 없다", !(await listKeys(A, tag)).has(key))
    check("방 상태 API 는 404 (거부되어야 하는 경우)", (await call(A, `/api/agent/rooms/${omnis.id}`)).status === 404)
    check("방에 새 글을 보내도 404 (거부되어야 하는 경우)", [404, 503].includes((await call(A, `/api/agent/rooms/${omnis.id}`, { method: "POST", body: JSON.stringify({ content: "다시 묻기" }) })).status))
    check("방 주소를 열면 404", (await call(A, `/chat/${omnis.id}`)).text.includes("NEXT_HTTP_ERROR_FALLBACK;404"))
    check("글 · 실행 · 사용 기록은 남는다(soft delete)",
      (await prisma.chatMessage.count({ where: { roomId: omnis.id } })) === 2 &&
      !!(await prisma.agentRun.findUnique({ where: { id: run.id } })) &&
      !!(await prisma.aiUsage.findUnique({ where: { id: usage.id } })))
    const pref = await prisma.chatRoomPref.findUnique({ where: { userId_roomKey: { userId: a.id, roomKey: key } } })
    check("즐겨찾기는 꺼진다", pref?.favorite === false && !!pref?.hiddenAt)

    // ─── 사람 1:1 — 숨기기 ───
    console.log("[2] 사람 1:1 — 숨기기는 상대가 새 글을 보내면 다시 보인다")
    const dm = await call(A, "/api/chat/people-rooms", { method: "POST", body: JSON.stringify({ userIds: [b.id] }) })
    const dmId = (dm.json as { roomId: string }).roomId
    const existed = (dm.json as { existing: boolean }).existing
    if (!existed) made.push(dmId)
    await call(A, "/api/chat/messages", { method: "POST", body: JSON.stringify({ roomId: dmId, content: `${tag} 첫 글` }) })
    const dmKey = `room:${dmId}`
    check("숨기기 200", (await patch(A, { roomKey: dmKey, hidden: true })).status === 200)
    check("A 목록에서 빠진다", !(await listKeys(A)).has(dmKey))
    check("B 목록에는 그대로", (await listKeys(B)).has(dmKey))
    check("A 는 방을 여전히 연다(숨김은 목록 정리)", (await call(A, `/api/chat/messages?roomId=${dmId}`)).status === 200)
    await new Promise((r) => setTimeout(r, 30))
    await call(B, "/api/chat/messages", { method: "POST", body: JSON.stringify({ roomId: dmId, content: `${tag} 답장` }) })
    check("B 가 새 글을 보내면 A 목록에 다시 보인다", (await listKeys(A)).has(dmKey))
    await patch(A, { roomKey: dmKey, hidden: true })
    check("다시 숨긴다", !(await listKeys(A)).has(dmKey))
    await call(A, "/api/chat/people-rooms", { method: "POST", body: JSON.stringify({ userIds: [b.id] }) })
    check("「사람과 대화」 로 같은 사람을 다시 고르면 숨김이 풀린다", (await listKeys(A)).has(dmKey))

    // ─── 거부되어야 하는 숨김 ───
    console.log("[3] 거부되어야 하는 숨김 — 전사방 · 업무방 · 단톡방 · 남의 방")
    check("전사방은 400", (await patch(A, { roomKey: "room:default-room", hidden: true })).status === 400)
    const task = await prisma.task.findFirst({ select: { id: true } })
    if (task) check("업무방은 400", (await patch(A, { roomKey: `task:${task.id}`, hidden: true })).status === 400)
    const group = await call(A, "/api/chat/people-rooms", { method: "POST", body: JSON.stringify({ userIds: [b.id, (await prisma.user.findFirst({ where: { isActive: true, id: { notIn: [a.id, b.id, "system"] } }, select: { id: true } }))!.id], name: tag }) })
    const groupId = (group.json as { roomId: string }).roomId
    made.push(groupId)
    check("단톡방 숨김은 400 — 나가기로 한다", (await patch(A, { roomKey: `room:${groupId}`, hidden: true })).status === 400)
    check("남의 옴니스 방은 404", (await patch(B, { roomKey: key, hidden: true })).status === 404)
    check("전사방은 목록에 그대로", (await listKeys(A)).has("room:default-room"))

    console.log("[4] 단톡방 나가기(기존 기능)")
    check("나가기 200", (await call(A, `/api/chat/people-rooms/${groupId}/members`, { method: "DELETE" })).status === 200)
    check("나간 방은 목록에 없다", !(await listKeys(A)).has(`room:${groupId}`))
  } finally {
    await prisma.chatRoomPref.deleteMany({ where: { roomKey: { in: made.map((id) => `room:${id}`) } } })
    await prisma.aiUsage.deleteMany({ where: { roomId: { in: made } } })
    await prisma.agentRun.deleteMany({ where: { roomId: { in: made } } })
    await prisma.notification.deleteMany({ where: { content: { contains: tag } } })
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: made } } })
    await prisma.chatMessage.deleteMany({ where: { content: { contains: tag } } })
    await prisma.chatRoom.deleteMany({ where: { id: { in: made } } })
    await prisma.$disconnect()
  }
  console.log(failed ? `✗ ${failed}건 실패` : "전부 통과")
  if (failed) process.exit(1)
}

void main()
