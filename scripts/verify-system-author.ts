/**
 * 시스템 계정 검증 — 🤖 메시지의 작성자가 관리자가 아니라 시스템 계정(Omnis)인가,
 * 그리고 그 계정으로 로그인하거나 담당자로 고를 수 없는가.
 *
 *   BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-system-author.ts
 *
 * Gemini 를 부르지 않는다 — GEMINI_API_KEY 를 지워 정규식 대체 경로(「완료」→ 담당자 확인 요청)로
 * 🤖 메시지를 만든다. chat-post 는 키를 호출 시점에 읽는다. 끝나면 만든 것을 전부 지운다(시스템 계정은 남긴다).
 */
import { hashSync, compareSync } from "bcryptjs"
import { prisma } from "../lib/db"
import { postChatMessage } from "../lib/chat-post"
import { SYSTEM_USER_ID, SYSTEM_USER_NAME, getSystemUserId } from "../lib/system-user"

delete process.env.GEMINI_API_KEY

const BASE = process.env.BASE ?? "http://localhost:3100"
const PW = "system-author-test-only"
let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

/** 이름·비밀번호로 로그인해 세션 쿠키를 돌려준다. 실패하면 세션이 비어 있다. */
async function login(name: string, password: string): Promise<string[]> {
  const jar: string[] = []
  const take = (h: Headers) => { for (const c of h.getSetCookie?.() ?? []) jar.push(c.split(";")[0]) }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); take(csrfRes.headers)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, name, password, callbackUrl: `${BASE}/dashboard` }), redirect: "manual",
  }); take(res.headers)
  return jar
}
const sessionOf = async (jar: string[]) =>
  (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie: jar.join("; ") } })).json()) as { user?: { name?: string } } | null

async function main() {
  const [instructor, assignee] = await Promise.all(
    ["__sys_지시자__", "__sys_담당자__"].map((name) =>
      prisma.user.upsert({
        where: { name }, update: { passwordHash: hashSync(PW, 10), isActive: true },
        create: { name, passwordHash: hashSync(PW, 10), role: "MEMBER" }, select: { id: true, name: true },
      })
    )
  )
  let taskId: string | null = null

  try {
    console.log("\n[1] 🤖 메시지 작성자")
    const task = await prisma.task.create({
      data: {
        name: "__시스템 작성자 검증__", slug: `__sys-author-${Date.now()}`, instructorId: instructor.id,
        assignees: { create: [{ userId: assignee.id }] }, checklists: { create: [{ name: "하나" }] },
      },
      select: { id: true },
    })
    taskId = task.id
    const { taskUpdate } = await postChatMessage({
      user: assignee, roomId: "default-room", content: "보고서 작성 완료했습니다", taskId: task.id,
    })
    check("완료 보고가 담당자 확인 요청으로 간다", taskUpdate?.action === "await_done_confirm", JSON.stringify(taskUpdate))
    const bot = await prisma.chatMessage.findFirst({
      where: { taskId: task.id, content: { startsWith: "🤖" } }, include: { author: { select: { id: true, name: true, role: true } } },
    })
    check("🤖 메시지가 생겼다", Boolean(bot))
    check(`작성자가 시스템 계정이다 — ${bot?.author.name}`, bot?.authorId === SYSTEM_USER_ID && bot?.author.name === SYSTEM_USER_NAME)
    check("작성자가 관리자가 아니다", bot?.author.role !== "ADMIN")

    console.log("\n[2] 시스템 계정은 사람이 아니다")
    const sys = await prisma.user.findUnique({ where: { id: SYSTEM_USER_ID } })
    check("비활성 계정이다", sys?.isActive === false)
    check("어떤 비밀번호와도 맞지 않는다", !!sys && !compareSync("!", sys.passwordHash) && !compareSync("", sys.passwordHash))
    await getSystemUserId()
    check("다시 불러도 한 명뿐이다", (await prisma.user.count({ where: { OR: [{ id: SYSTEM_USER_ID }, { name: SYSTEM_USER_NAME }] } })) === 1)

    const sysLogin = await sessionOf(await login(SYSTEM_USER_NAME, "!"))
    check("시스템 계정으로는 로그인되지 않는다", !sysLogin?.user, JSON.stringify(sysLogin))
    const jar = await login(assignee.name, PW)
    const me = await sessionOf(jar)
    check("같은 방법으로 사람 계정은 로그인된다 (대조군)", me?.user?.name === assignee.name, JSON.stringify(me))
    const users = (await (await fetch(`${BASE}/api/users`, { headers: { cookie: jar.join("; ") } })).json()) as { id: string }[]
    check("구성원 목록(/api/users)에 없다", Array.isArray(users) && users.length > 0 && !users.some((u) => u.id === SYSTEM_USER_ID))
  } finally {
    if (taskId) {
      const ids = (await prisma.chatMessage.findMany({ where: { taskId }, select: { id: true } })).map((m) => m.id)
      await prisma.notification.deleteMany({ where: { entityId: taskId } })
      await prisma.chatMention.deleteMany({ where: { messageId: { in: ids } } })
      await prisma.embeddingChunk.deleteMany({ where: { OR: [{ source: "TASK", sourceId: taskId }, { source: "CHAT_MESSAGE", sourceId: { in: ids } }] } })
      await prisma.chatMessage.deleteMany({ where: { taskId } })
      await prisma.checklist.deleteMany({ where: { taskId } })
      await prisma.taskAssignee.deleteMany({ where: { taskId } })
      await prisma.task.delete({ where: { id: taskId } })
    }
    for (const u of [instructor, assignee]) {
      await prisma.activityLog.deleteMany({ where: { userId: u.id } }).catch(() => {})
      await prisma.geminiUsage.deleteMany({ where: { userId: u.id } }).catch(() => {})
      await prisma.user.delete({ where: { id: u.id } })
    }
    console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed`)
    await prisma.$disconnect()
    if (failed > 0) process.exit(1)
  }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
