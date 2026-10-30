/**
 * 첨부 접근 HTTP 검증 — 참여자만 보는 방(옴니스 1:1 · 사람 1:1 · 단톡방)의 파일이 그 밖으로 새지 않는가.
 * 모델을 부르지 않는다(비용 0) — 옴니스 묻기는 거절되어야 하는 요청만 보낸다.
 *
 *   BASE=http://localhost:3118 pnpm exec tsx --env-file=.env scripts/verify-file-access.ts
 *
 * dev 서버가 떠 있어야 한다. 로컬 NEXTAUTH_SECRET 으로 세 사람(A · B · C)의 세션 쿠키를 만든다.
 * 올린 파일(로컬 .env 의 NAS _dev 아래) · 만든 방 · 글은 끝에 지운다. 로컬 DB 가 아니면 멈춘다.
 */
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"
import { deleteObject, objectKeyFor } from "../lib/storage"

const BASE = process.env.BASE ?? "http://localhost:3118"
const TAG = `attach-${Date.now().toString(36)}`
let failed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail).slice(0, 300)}`}`)
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

async function call(cookie: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: "manual", headers: { cookie, ...(init.headers ?? {}) } })
  const text = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {
    // 파일 본문 · 화면
  }
  return { status: res.status, json: json as Record<string, unknown> & unknown[], text }
}
const postJson = (c: string, p: string, body: unknown) => call(c, p, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } })

const uploaded: { id: string; name: string }[] = []
async function upload(cookie: string, name: string, scope: "private" | null) {
  const form = new FormData()
  form.append("file", new Blob([`${TAG} ${name} 본문`], { type: "text/plain" }), name)
  if (scope) form.append("scope", scope)
  const r = await call(cookie, "/api/files", { method: "POST", body: form })
  if (r.status === 201) uploaded.push({ id: String(r.json.id), name })
  return r
}
const listIds = async (cookie: string) => ((await call(cookie, "/api/files")).json as unknown as { id: string }[]).map((f) => f.id)

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
  const madeRooms: string[] = []

  try {
    console.log("[1] 옴니스 방에 붙이려고 올린 파일(scope=private) — 붙기 전")
    const up = await upload(A, `${TAG}-omnis.txt`, "private")
    check("A 가 올린다 201", up.status === 201, up)
    const fid = String(up.json.id)
    const row = await prisma.file.findUnique({ where: { id: fid }, select: { privateToUserId: true, messageId: true } })
    check("행에 올린 사람이 남는다(privateToUserId = A)", row?.privateToUserId === a.id && row.messageId === null, row)
    check("A 는 내려받는다 200", (await call(A, `/api/files/${fid}/raw`)).status === 200)
    const rawB = await call(B, `/api/files/${fid}/raw`)
    check("B 는 내려받지 못한다 404 · 본문 없음 (거부되어야 하는 경우)", rawB.status === 404 && !rawB.text.includes(TAG), rawB.status)
    check("B 는 파일 정보도 404 (거부되어야 하는 경우)", (await call(B, `/api/files/${fid}`)).status === 404)
    check("A 의 최근 파일 목록에는 있다", (await listIds(A)).includes(fid))
    check("B 의 최근 파일 목록(GET /api/files)에 없다 (거부되어야 하는 경우)", !(await listIds(B)).includes(fid))

    console.log("[2] 거부되어야 하는 붙이기 — 모델을 부르기 전에 막힌다")
    const usage0 = await prisma.aiUsage.count()
    const rooms0 = await prisma.chatRoom.count({ where: { createdById: b.id, kind: "OMNIS_DM" } })
    const steal = await postJson(B, "/api/agent/rooms", { content: "이 파일 요약해 줘", fileIds: [fid] })
    check("B 가 A 의 파일을 자기 옴니스 질문에 붙이면 404 (거부되어야 하는 경우)", steal.status === 404, steal)
    check("B 의 빈 옴니스 방이 생기지 않았다", (await prisma.chatRoom.count({ where: { createdById: b.id, kind: "OMNIS_DM" } })) === rooms0)
    const missing = await postJson(A, "/api/agent/rooms", { content: "이 파일 요약해 줘", fileIds: ["00000000-0000-4000-8000-000000000000"] })
    check("없는 파일 404 — 남의 파일과 같은 답 (거부되어야 하는 경우)", missing.status === 404 && missing.json?.error === steal.json?.error, missing)
    const bad = await postJson(A, "/api/agent/rooms", { content: "이 파일 요약해 줘", fileIds: ["../../etc/passwd"] })
    check("id 모양이 아니면 400(Zod)", bad.status === 400, bad)
    const pub = await upload(A, `${TAG}-public.txt`, null)
    const pubTry = await postJson(A, "/api/agent/rooms", { content: "이 파일 요약해 줘", fileIds: [String(pub.json.id)] })
    check("공개 파일(scope 없음)은 옴니스 질문에 붙지 않는다 404", pubTry.status === 404, pubTry)
    check("모델을 부르지 않았다(AiUsage 줄 그대로)", (await prisma.aiUsage.count()) === usage0)

    console.log("[3] 공개 자리로 옮기기 — 전사방 글에 비공개 파일 id 를 넣어도 붙지 않는다")
    const company = await postJson(A, "/api/chat/messages", { roomId: "default-room", content: `${TAG} 전사방 시험 글`, fileIds: [fid] })
    check("전사방 글은 올라간다 201", company.status === 201, company.status)
    const after = await prisma.file.findUnique({ where: { id: fid }, select: { messageId: true, taskId: true } })
    check("비공개 파일은 전사방 글에 붙지 않았다 (거부되어야 하는 경우)", after?.messageId === null && after?.taskId === null, after)
    if (company.json?.id) await prisma.chatMessage.update({ where: { id: String(company.json.id) }, data: { deletedAt: new Date() } })

    console.log("[4] 옴니스 질문에 붙은 뒤 — 방 주인만 (질문 글을 DB 로 직접 만들어 붙인다 — 모델 없이)")
    const room = await prisma.chatRoom.create({
      data: { name: `${TAG} 옴니스`, kind: "OMNIS_DM", createdById: a.id, members: { create: { userId: a.id } } },
      select: { id: true },
    })
    madeRooms.push(room.id)
    const q = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: a.id, content: `${TAG} 질문` } })
    await prisma.file.update({ where: { id: fid }, data: { messageId: q.id } })
    check("A(방 주인)는 내려받는다 200", (await call(A, `/api/files/${fid}/raw`)).status === 200)
    check("B 는 404 (거부되어야 하는 경우)", (await call(B, `/api/files/${fid}/raw`)).status === 404)
    check("C 도 404 (거부되어야 하는 경우)", (await call(C, `/api/files/${fid}/raw`)).status === 404)
    check("B 의 최근 파일 목록에 없다", !(await listIds(B)).includes(fid))
    const roomState = await call(A, `/api/agent/rooms/${room.id}`)
    const qShape = (roomState.json?.messages as unknown as { id: string; files?: { id: string }[] }[] | undefined)?.find((m) => m.id === q.id)
    check("방 상태 API 가 질문 글의 파일을 내려준다(말풍선 아래 카드)", qShape?.files?.[0]?.id === fid, qShape)
    const again = await postJson(A, `/api/agent/rooms/${room.id}`, { content: "다시 붙여 볼게", fileIds: [fid] })
    check("이미 붙은 파일을 또 붙이면 409 (거부되어야 하는 경우)", again.status === 409, again)
  } finally {
    // 만든 것 정리 — 글 · 방 · 파일 행 · NAS 의 _dev 사본
    for (const f of uploaded) {
      await deleteObject(objectKeyFor(f.id, f.name)).catch(() => {})
    }
    await prisma.file.deleteMany({ where: { id: { in: uploaded.map((f) => f.id) } } })
    await prisma.chatMessage.deleteMany({ where: { roomId: { in: madeRooms } } })
    await prisma.chatRoom.deleteMany({ where: { id: { in: madeRooms } } })
  }
  console.log(failed ? `실패 ${failed}` : "전부 통과")
  await prisma.$disconnect()
  process.exit(failed ? 1 : 0)
}

void main()
