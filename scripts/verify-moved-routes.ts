/**
 * 알맹이를 lib 로 옮긴 화면 라우트 세 개가 예전처럼 응답하는지 — 실제 HTTP 로.
 *
 *   BASE=http://localhost:3100 npx tsx --env-file=.env scripts/verify-moved-routes.ts
 *
 * PATCH /api/tasks/[id] · /api/tasks/[id]/checklists(POST·PATCH·DELETE) · PATCH /api/notifications(response)
 * · /api/reports/weekly(GET·POST·PATCH·DELETE) · /api/omnis/cards(POST·PATCH·DELETE) · GET /api/chat/feed.
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

  let cardId: string | null = null
  const b = api(await login("__route_지시자__"))
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

    console.log("\n[4] /api/reports/weekly")
    check("로그인 없이 GET 은 401", (await api("")("/api/reports/weekly", "GET")).status === 401)
    const madeRes = await w("/api/reports/weekly", "POST", { generateDraft: false })
    const report = (await madeRes.json()) as { id: string; isoWeek: string; owner?: { name: string }; content: { completed: string[] } }
    check("POST 201 + 이번 주 보고서(주차·소유자 포함)", madeRes.status === 201 && !!report.id && !!report.isoWeek && !!report.owner, JSON.stringify(report).slice(0, 120))
    check("id 없는 PATCH 는 400", (await w("/api/reports/weekly", "PATCH", { markdown: "x" })).status === 400)
    check("남의 보고서 PATCH 는 404", (await b("/api/reports/weekly", "PATCH", { id: report.id, markdown: "x" })).status === 404)
    const reportPatched = (await (await w("/api/reports/weekly", "PATCH", { id: report.id, markdown: "## 라우트", status: "제출 완료" })).json()) as { status: string; submittedAt: string | null; content: { markdown: string } }
    check("본문·제출 상태가 반영된다", reportPatched.status === "제출 완료" && !!reportPatched.submittedAt && reportPatched.content.markdown === "## 라우트", JSON.stringify(reportPatched).slice(0, 120))
    const mine = (await (await w("/api/reports/weekly", "GET")).json()) as { id: string }[]
    check("GET 은 본인 것만 준다", mine.some((r) => r.id === report.id) && mine.length === 1, String(mine.length))
    check("남의 보고서 DELETE 는 404", (await b(`/api/reports/weekly?id=${report.id}`, "DELETE")).status === 404)
    check("본인 DELETE 는 200 + 사라진다", (await w(`/api/reports/weekly?id=${report.id}`, "DELETE")).status === 200 && (await prisma.weeklyReport.count({ where: { id: report.id } })) === 0)

    console.log("\n[5] /api/omnis/cards")
    const category = await prisma.omnisCategory.findFirst({ select: { id: true, name: true } })
    if (category) {
      check("categoryId 없는 POST 는 400", (await w("/api/omnis/cards", "POST", { title: "x" })).status === 400)
      const cardRes = await w("/api/omnis/cards", "POST", { categoryId: category.id, title: "__라우트 카드__", content: { sections: [] }, tags: ["라우트"] })
      const card = (await cardRes.json()) as { id: string; version: number; category: { name: string } }
      cardId = card.id
      check("POST 201 + 분류가 함께 온다", cardRes.status === 201 && !!card.id && card.category.name === category.name)
      check("없는 카드 PATCH 는 404", (await w("/api/omnis/cards", "PATCH", { id: "00000000-0000-0000-0000-000000000000", title: "x" })).status === 404)
      const upd = (await (await w("/api/omnis/cards", "PATCH", { id: card.id, title: "__라우트 카드2__" })).json()) as { title: string; version: number }
      check("PATCH 가 제목과 버전을 올린다", upd.title === "__라우트 카드2__" && upd.version === card.version + 1, JSON.stringify(upd).slice(0, 80))
      check("버전 기록이 두 건 쌓인다", (await prisma.omnisCardVersion.count({ where: { cardId: card.id } })) === 2)
      check("DELETE 200 + 사라진다", (await w(`/api/omnis/cards?id=${card.id}`, "DELETE")).status === 200 && (await prisma.omnisCard.count({ where: { id: card.id } })) === 0)
      cardId = null
    }

    console.log("\n[6] GET /api/chat/feed")
    check("로그인 없이 401", (await api("")("/api/chat/feed", "GET")).status === 401)
    check("모르는 view 는 400", (await w("/api/chat/feed?view=inbox", "GET")).status === 400)
    const feedRes = await w("/api/chat/feed?view=all&take=5", "GET")
    const feed = (await feedRes.json()) as { id: string; createdAt: string; author: { name: string } }[]
    check("200 + 시간순(오래된 것 먼저) · ISO 시각", feedRes.status === 200 && Array.isArray(feed) &&
      (feed.length < 2 || feed[0].createdAt <= feed[feed.length - 1].createdAt) &&
      (feed.length === 0 || (!!feed[0].author && /^\d{4}-\d{2}-\d{2}T/.test(feed[0].createdAt))), `${feed.length}건`)
  } finally {
    if (cardId) {
      await prisma.omnisCardVersion.deleteMany({ where: { cardId } })
      await prisma.omnisCard.delete({ where: { id: cardId } }).catch(() => {})
    }
    for (const u of [boss, worker]) await prisma.weeklyReport.deleteMany({ where: { ownerId: u.id } })
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
