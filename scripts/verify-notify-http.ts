/**
 * 푸시 · 알림 설정 HTTP 검증 — 실제 라우트(응답 뒤 after() 발송 포함)를 dev 서버로 돈다. 모델을 부르지 않는다.
 *
 *   dev:   GEMINI_API_KEY= PUSH_DRY_RUN=1 PUSH_LOG_FILE=<기록> NEXTAUTH_URL=http://localhost:3106 pnpm next dev --webpack -p 3106
 *   검증:  BASE=http://localhost:3106 PUSH_LOG_FILE=<같은 기록> pnpm exec tsx --env-file=.env scripts/verify-notify-http.ts
 *
 * dev 서버가 쓰는 발송 기록 파일을 읽어 「누구에게 무엇이 나갔는가」 를 본다. 시험용 사람 · 방 · 업무는 끝에 지운다.
 */
import { readFileSync, existsSync } from "node:fs"
import { encode } from "next-auth/jwt"
import { prisma } from "../lib/db"

const BASE = process.env.BASE ?? "http://localhost:3106"
const LOG = process.env.PUSH_LOG_FILE ?? ""
if (!LOG) throw new Error("PUSH_LOG_FILE 이 필요하다(dev 서버와 같은 파일)")
const db = new URL(process.env.DATABASE_URL!)
if (!["localhost", "127.0.0.1"].includes(db.hostname)) throw new Error(`로컬 DB 가 아니다: ${db.hostname}`)

const TAG = `vh${Date.now().toString(36)}`
let failed = 0
let passed = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${ok || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`)
  if (ok) passed++
  else failed++
}

type U = { id: string; name: string; role: string }
async function cookieFor(u: U) {
  const token = await encode({ token: { sub: u.id, id: u.id, role: u.role, name: u.name }, secret: process.env.NEXTAUTH_SECRET!, salt: "authjs.session-token", maxAge: 600 })
  return `authjs.session-token=${token}`
}
async function call(cookie: string | null, path: string, init: { method?: string; json?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), "Content-Type": "application/json" },
    ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}),
  })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {}
  return { status: res.status, body: body as Record<string, unknown> }
}

type Line = { userId: string; category: string | null; outcome: string; title: string; tag?: string; url?: string }
const readLog = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line) : [])
/** 응답 뒤(after)에 나가므로 기록이 생길 때까지 잠깐 기다린다 */
async function linesAfter(start: number, pred: (l: Line) => boolean, minCount: number, ms = 8000): Promise<Line[]> {
  const until = Date.now() + ms
  let got: Line[] = []
  while (Date.now() < until) {
    got = readLog().slice(start).filter(pred)
    if (got.length >= minCount) {
      await new Promise((r) => setTimeout(r, 500)) // 더 올 것이 있으면 마저 받는다
      return readLog().slice(start).filter(pred)
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return got
}

const made = { users: [] as string[], rooms: [] as string[], tasks: [] as string[] }

async function main() {
  const mk = async (n: string) => {
    const u = await prisma.user.create({ data: { name: `__${TAG}_${n}`, passwordHash: "!", role: "MEMBER" }, select: { id: true, name: true, role: true } })
    made.users.push(u.id)
    return u
  }
  const [A, B, C] = await Promise.all([mk("A"), mk("B"), mk("C")])
  const [cA, cB] = await Promise.all([cookieFor(A), cookieFor(B)])

  console.log("\n[1] 종류별 설정 API")
  check("로그인 없이 401", (await call(null, "/api/notification-prefs")).status === 401)
  let r = await call(cA, "/api/notification-prefs")
  check("행이 없으면 전부 켜짐", r.status === 200 && JSON.stringify(r.body) === JSON.stringify({ chat: true, task: true, calendar: true }), r.body)
  r = await call(cA, "/api/notification-prefs", { method: "PATCH", json: { task: false } })
  check("업무만 끈다 → 나머지는 그대로", r.status === 200 && JSON.stringify(r.body) === JSON.stringify({ chat: true, task: false, calendar: true }), r.body)
  check("바꿀 것 없는 PATCH 400", (await call(cA, "/api/notification-prefs", { method: "PATCH", json: {} })).status === 400)
  check("불리언이 아니면 400", (await call(cA, "/api/notification-prefs", { method: "PATCH", json: { chat: "off" } })).status === 400)
  await call(cA, "/api/notification-prefs", { method: "PATCH", json: { task: true } })

  console.log("\n[2] 방 알림 끄기 API · 목록 표시")
  const companyId = `${TAG}-company`
  made.rooms.push(companyId)
  await prisma.chatRoom.create({ data: { id: companyId, name: "HTTP 시험 전사방", kind: "COMPANY" } })
  r = await call(cB, "/api/chat/prefs", { method: "PATCH", json: { roomKey: `room:${companyId}`, muted: true } })
  check("B 가 전사방 알림 끄기 200 · muted=true", r.status === 200 && r.body.muted === true, r.body)
  const list = await call(cB, "/api/chat/rooms")
  const row = (list.body.company as { key: string; muted: boolean }[] | undefined)?.find((x) => x.key === `room:${companyId}`)
  check("B 의 방 목록에 muted=true 로 온다", row?.muted === true, row)
  const dm = await prisma.chatRoom.create({ data: { kind: "DM", name: "남의 1:1", dmKey: `${TAG}-dm`, members: { create: [{ userId: A.id }, { userId: C.id }] } }, select: { id: true } })
  made.rooms.push(dm.id)
  check("남의 1:1 방은 끌 수 없다(없는 방과 같은 404)", (await call(cB, "/api/chat/prefs", { method: "PATCH", json: { roomKey: `room:${dm.id}`, muted: true } })).status === 404)
  check("muted 가 불리언이 아니면 400", (await call(cB, "/api/chat/prefs", { method: "PATCH", json: { roomKey: `room:${companyId}`, muted: "yes" } })).status === 400)

  console.log("\n[3] 채팅 글 — 라우트 응답 뒤(after) 발송")
  let start = readLog().length
  const t0 = performance.now()
  r = await call(cA, "/api/chat/messages", { method: "POST", json: { roomId: companyId, content: "HTTP 시험 공지" } })
  const ms = Math.round(performance.now() - t0)
  check(`글쓰기 201 (${ms}ms)`, r.status === 201, r.body)
  const chat = await linesAfter(start, (l) => l.tag === `omnis:chat:room:${companyId}`, 1)
  const active = await prisma.user.count({ where: { isActive: true, id: { not: "system" } } })
  check(`받은 사람 ${chat.length}명 = 활성 ${active}명 − A(글쓴이) − B(방 끔)`, chat.length === active - 2 && !chat.some((l) => l.userId === A.id || l.userId === B.id), { n: chat.length })

  console.log("\n[4] 화면 업무 생성 · 수정 — 담당자 지정")
  start = readLog().length
  r = await call(cA, "/api/tasks", { method: "POST", json: { name: `HTTP 시험 업무 ${TAG}`, ownerIds: [A.id, B.id, B.id] } })
  check("같은 담당자 id 가 두 번 와도 업무 생성 201(예전에는 500)", r.status === 201, r.body)
  const taskId = (r.body as { id?: string }).id
  if (taskId) made.tasks.push(taskId)
  let task = await linesAfter(start, (l) => l.category === "task", 1)
  check("B 에게 한 번만 · A(지시자 자신)는 없음", task.length === 1 && task[0].userId === B.id && task[0].url?.startsWith(`/tasks/${taskId}`) === true, task)
  start = readLog().length
  r = await call(cA, `/api/tasks/${taskId}`, { method: "PATCH", json: { assigneeIds: [B.id, C.id] } })
  check("담당자 바꾸기 200", r.status === 200, r.body)
  task = await linesAfter(start, (l) => l.category === "task", 1)
  check("새로 된 C 에게만", task.length === 1 && task[0].userId === C.id, task)

  console.log("\n[5] 화면")
  r = await call(cA, "/calendar?day=2026-11-03")
  check("/calendar?day= 200", r.status === 200)
  r = await call(cA, "/api/push/test", { method: "POST" })
  check("시험 알림은 dry run 이라 보내지 않고 200", r.status === 200 && r.body.skipped === "dry_run", r.body)
}

async function cleanup() {
  await prisma.notification.deleteMany({ where: { userId: { in: made.users } } })
  await prisma.chatMessage.deleteMany({ where: { OR: [{ roomId: { in: made.rooms } }, { taskId: { in: made.tasks } }, { authorId: { in: made.users } }] } })
  await prisma.chatRoom.deleteMany({ where: { id: { in: made.rooms } } })
  await prisma.taskEvent.deleteMany({ where: { taskId: { in: made.tasks } } }).catch(() => {})
  await prisma.activityLog.deleteMany({ where: { userId: { in: made.users } } }).catch(() => {})
  await prisma.task.deleteMany({ where: { id: { in: made.tasks } } })
  await prisma.user.deleteMany({ where: { id: { in: made.users } } })
}

main()
  .catch((e) => {
    console.error(e)
    failed++
  })
  .finally(async () => {
    await new Promise((r) => setTimeout(r, 1500)) // 응답 뒤 일이 끝나기를 기다린 뒤 지운다
    await cleanup().catch((e) => console.error("[정리 실패]", e))
    console.log(`\n${passed} 통과 · ${failed} 실패`)
    await prisma.$disconnect()
    process.exit(failed ? 1 : 0)
  })
