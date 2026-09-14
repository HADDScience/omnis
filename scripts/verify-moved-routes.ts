/**
 * 알맹이를 lib 로 옮긴 화면 라우트 세 개가 예전처럼 응답하는지 — 실제 HTTP 로.
 *
 *   BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-moved-routes.ts
 *
 * PATCH /api/tasks/[id] · /api/tasks/[id]/checklists(POST·PATCH·DELETE) · PATCH /api/notifications(response).
 * MCP 쪽은 verify-omnis-mcp 가 같은 lib 함수를 돌린다. 여기는 라우트 껍데기(인증·상태 코드·응답 모양)를 본다.
 */
import { hashSync } from "bcryptjs"
import { prisma } from "../lib/db"

const BASE = process.env.BASE ?? "http://localhost:3100"
const PW = "moved-routes-test-only"
let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`) }
}

async function login(name: string): Promise<string> {
  const jar: string[] = []
  const take = (h: Headers) => { for (const c of h.getSetCookie?.() ?? []) jar.push(c.split(";")[0]) }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`); take(csrfRes.headers)
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string }
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar.join("; ") },
    body: new URLSearchParams({ csrfToken, name, password: PW, callbackUrl: `${BASE}/dashboard` }), redirect: "manual",
  }); take(res.headers)
  return jar.join("; ")
}

async function main() {
  const [boss, worker] = await Promise.all(["__route_지시자__", "__route_담당자__"].map((name) =>
    prisma.user.upsert({ where: { name }, update: { passwordHash: hashSync(PW, 10), isActive: true }, create: { name, passwordHash: hashSync(PW, 10), role: "MEMBER" }, select: { id: true } })
  ))
  const task = await prisma.task.create({
    data: { name: "__라우트 검증__", slug: `__route-${Date.now()}`, instructorId: boss.id, assignees: { create: [{ userId: worker.id }] } },
    select: { id: true },
  })
  const api = (cookie: string) => (path: string, method: string, body?: unknown) =>
    fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) })

  try {
    const anon = api("")
    check("로그인 없이 업무 PATCH 는 401", (await anon(`/api/tasks/${task.id}`, "PATCH", { status: "DONE" })).status === 401)
    const w = api(await login("__route_담당자__"))

    console.log("\n[1] PATCH /api/tasks/[id]")
    const bad = await w(`/api/tasks/${task.id}`, "PATCH", { status: "FINISHED" })
    check("모르는 상태는 400", bad.status === 400, String(bad.status))
    const ok = await w(`/api/tasks/${task.id}`, "PATCH", { status: "IN_PROGRESS", priority: "HIGH" })
    const body = (await ok.json()) as { status?: string; priority?: string; assignees?: unknown[]; instructor?: { name: string } }
    check("200 + 업무 본문(담당·지시자 포함)", ok.status === 200 && body.status === "IN_PROGRESS" && body.priority === "HIGH" && Array.isArray(body.assignees) && !!body.instructor, JSON.stringify(body).slice(0, 160))

    console.log("\n[2] 체크리스트")
    const emptyName = await w(`/api/tasks/${task.id}/checklists`, "POST", { name: " " })
    check("빈 이름 POST 는 400", emptyName.status === 400, String(emptyName.status))
    const created = await w(`/api/tasks/${task.id}/checklists`, "POST", { name: "라우트 항목" })
    const item = (await created.json()) as { id: string; name: string }
    check("POST 201 + 항목", created.status === 201 && item.name === "라우트 항목")
    const noId = await w(`/api/tasks/${task.id}/checklists`, "PATCH", { done: true })
    check("id 없는 PATCH 는 400", noId.status === 400)
    const patched = (await (await w(`/api/tasks/${task.id}/checklists`, "PATCH", { id: item.id, done: true })).json()) as { done: boolean }
    check("PATCH 가 체크한다", patched.done === true)
    const del = await w(`/api/tasks/${task.id}/checklists?id=${item.id}`, "DELETE")
    check("DELETE 200 + 지워졌다", del.status === 200 && (await prisma.checklist.count({ where: { id: item.id } })) === 0)

    console.log("\n[3] PATCH /api/notifications (response)")
    const n = await prisma.notification.create({ data: { userId: worker.id, type: "task_done_confirm", title: "완료 확인", content: "검증", entityId: task.id, actionType: "confirm_done" } })
    const wrongResp = await w("/api/notifications", "PATCH", { id: n.id, response: "accept" })
    check("허용되지 않는 응답은 400", wrongResp.status === 400, String(wrongResp.status))
    const b = api(await login("__route_지시자__"))
    const notMine = await b("/api/notifications", "PATCH", { id: n.id, response: "confirm_done" })
    check("남의 알림은 404", notMine.status === 404, String(notMine.status))
    const confirm = await w("/api/notifications", "PATCH", { id: n.id, response: "confirm_done" })
    const cBody = (await confirm.json()) as { ok?: boolean; status?: string }
    check("confirm_done 은 200 { ok, status: DONE }", confirm.status === 200 && cBody.ok === true && cBody.status === "DONE", JSON.stringify(cBody))
    check("업무가 완료됐고 지시자에게 알림이 갔다", (await prisma.task.findUnique({ where: { id: task.id } }))?.status === "DONE" &&
      (await prisma.notification.count({ where: { userId: boss.id, entityId: task.id, type: "task_status_changed" } })) === 1)
    const again = (await (await w("/api/notifications", "PATCH", { id: n.id, response: "confirm_done" })).json()) as { alreadyResolved?: boolean }
    check("두 번 누르면 alreadyResolved · 지시자 알림은 그대로 1건", again.alreadyResolved === true &&
      (await prisma.notification.count({ where: { userId: boss.id, entityId: task.id, type: "task_status_changed" } })) === 1)
  } finally {
    await prisma.notification.deleteMany({ where: { entityId: task.id } })
    await prisma.embeddingChunk.deleteMany({ where: { source: "TASK", sourceId: task.id } })
    await prisma.checklist.deleteMany({ where: { taskId: task.id } })
    await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } })
    await prisma.task.delete({ where: { id: task.id } })
    for (const u of [boss, worker]) {
      await prisma.activityLog.deleteMany({ where: { userId: u.id } })
      await prisma.geminiUsage.deleteMany({ where: { userId: u.id } })
      await prisma.user.delete({ where: { id: u.id } })
    }
    console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed`)
    await prisma.$disconnect()
    if (failed > 0) process.exit(1)
  }
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
