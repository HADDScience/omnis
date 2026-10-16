// 업무 변경 이력(TaskEvent) — 바뀐 것만 한 줄씩, 경로가 맞게 남는지.
//   npx tsx scripts/verify-task-events.ts        (로컬 .env 의 DB 에 시험 업무를 만들고 끝나면 지운다)
//
// 실제 함수(updateTask · 체크리스트 · 알림 완료 확인)를 그대로 부른다. AI 호출(색인 · 지식카드 제안)이
// 돌지 않게 Gemini 키를 비운다 — 이 시험이 비용을 쓰지 않는다. 채팅 AI 경로(runTaskRebuild)는
// Gemini 가 있어야 돌아서 여기서 부르지 않는다.
process.env.GEMINI_API_KEY = ""
export {}

const { prisma } = await import("../lib/db")
const { updateTask } = await import("../lib/task-update")
const { addChecklistItem, updateChecklistItem, deleteChecklistItem } = await import("../lib/checklists")
const { respondToAction } = await import("../lib/notifications")
const { recordTaskEvents } = await import("../lib/task-events")

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("로컬 DB 에서만 돈다 — 시험 업무를 만들고 지운다")

let fail = 0
// JSONB 는 키를 정렬해 돌려준다 — 키 순서는 비교하지 않는다
const sorted = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sorted) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(sorted(got)) === JSON.stringify(sorted(want))
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

const users = await prisma.user.findMany({ where: { isActive: true, name: { not: { contains: "시스템" } } }, select: { id: true, name: true }, take: 2, orderBy: { createdAt: "asc" } })
if (users.length < 2) throw new Error("사용자가 2명 이상 있어야 한다")
const [a, b] = users

const task = await prisma.task.create({
  data: { name: "시험용 업무 — 견본 시약 주문", slug: `verify-task-events-${Date.now()}`, instructorId: a.id, assignees: { create: [{ userId: a.id }] } },
})
const events = () => prisma.taskEvent.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } })
let seen = 0
const added = async () => { const all = await events(); const fresh = all.slice(seen); seen = all.length; return fresh }

try {
  console.log("── 업무 수정 (updateTask)")
  await updateTask(task.id, a.id, { status: "IN_PROGRESS" })
  let e = await added()
  check("할 일 → 진행 중: 한 줄", e.map((x) => [x.field, x.before, x.after, x.via]), [["status", "TODO", "IN_PROGRESS", "web"]])

  await updateTask(task.id, a.id, { status: "IN_PROGRESS", name: "시험용 업무 — 견본 시약 주문(수정)" })
  check("거부: 같은 상태로 다시 저장 · 이름만 바꿈 → 0줄", (await added()).length, 0)

  await updateTask(task.id, a.id, { assigneeIds: [b.id, a.id] })
  e = await added()
  check("담당자 추가: 한 줄 · 정렬된 목록", e.map((x) => [x.field, x.after]), [["assignees", [a.id, b.id].sort()]])

  await updateTask(task.id, a.id, { assigneeIds: [a.id, b.id] })
  check("거부: 같은 담당자를 순서만 바꿔 저장 → 0줄", (await added()).length, 0)

  await updateTask(task.id, a.id, { deadline: "2026-11-30T14:59:59.000Z" })
  e = await added()
  check("마감 설정: 한 줄 (null → 날짜)", e.map((x) => [x.field, x.before, x.after]), [["deadline", null, "2026-11-30T14:59:59.000Z"]])

  await updateTask(task.id, a.id, { deadline: "2026-11-30T14:59:59.000Z" })
  check("거부: 같은 마감으로 다시 저장 → 0줄", (await added()).length, 0)

  await updateTask(task.id, a.id, { status: "REVIEW" }, "mcp")
  e = await added()
  check("MCP 로 바꾸면 경로가 mcp", e.map((x) => [x.after, x.via, x.actorId === a.id]), [["REVIEW", "mcp", true]])

  const missing = await updateTask("00000000-0000-0000-0000-000000000000", a.id, { status: "DONE" })
  check("거부: 없는 업무 → 오류 · 0줄", ["error" in missing, await prisma.taskEvent.count({ where: { taskId: "00000000-0000-0000-0000-000000000000" } })], [true, 0])

  console.log("── 체크리스트")
  const item = await addChecklistItem(task.id, "견적서 받기", a.id)
  e = await added()
  check("추가: 한 줄 (없음 → 항목)", e.map((x) => [x.field, x.before, x.after]), [["checklist", null, { name: "견적서 받기", done: false }]])

  await updateChecklistItem(item.id, { done: true }, a.id)
  e = await added()
  check("체크: 한 줄", e.map((x) => [x.before, x.after]), [[{ name: "견적서 받기", done: false }, { name: "견적서 받기", done: true }]])

  await updateChecklistItem(item.id, { memo: "메일로 받음" }, a.id)
  check("거부: 메모만 바꿈 → 0줄", (await added()).length, 0)

  await deleteChecklistItem(item.id, a.id, "mcp")
  e = await added()
  check("삭제: 한 줄 (항목 → 없음) · mcp", e.map((x) => [x.before, x.after, x.via]), [[{ name: "견적서 받기", done: true }, null, "mcp"]])

  console.log("── 알림에서 완료 확인")
  const n = await prisma.notification.create({
    data: { userId: a.id, type: "task_done_confirm", title: "시험", entityId: task.id, actionType: "confirm_done" },
  })
  await respondToAction(a.id, a.name, n.id, "confirm_done")
  e = await added()
  check("완료 확인: 검토 → 완료 · notification", e.map((x) => [x.field, x.before, x.after, x.via]), [["status", "REVIEW", "DONE", "notification"]])

  await respondToAction(a.id, a.name, n.id, "confirm_done")
  check("거부: 같은 알림을 두 번 눌러도 0줄", (await added()).length, 0)

  console.log("── 비교 규칙 (recordTaskEvents)")
  check("Date 와 같은 ISO 문자열은 같은 값", await recordTaskEvents(task.id, a.id, "web", [{ field: "deadline", before: new Date("2026-11-30T14:59:59.000Z"), after: "2026-11-30T14:59:59.000Z" }]), 0)
  check("키 순서만 다른 객체는 같은 값", await recordTaskEvents(task.id, a.id, "web", [{ field: "checklist", before: { done: true, name: "견적서 받기" }, after: { name: "견적서 받기", done: true } }]), 0)
  check("undefined 와 null 은 같은 값", await recordTaskEvents(task.id, a.id, "web", [{ field: "deadline", before: undefined, after: null }]), 0)
  check("여러 변경 중 바뀐 것만", await recordTaskEvents(task.id, a.id, "chat-ai", [
    { field: "status", before: "DONE", after: "IN_PROGRESS" },
    { field: "archived", before: false, after: false },
  ]), 1)
  seen = (await events()).length
} finally {
  // 시험 흔적을 지운다 — 이력은 업무와 함께 지워진다(onDelete: Cascade)
  await prisma.notification.deleteMany({ where: { entityId: task.id } })
  await prisma.activityLog.deleteMany({ where: { entityId: task.id } })
  await prisma.task.delete({ where: { id: task.id } })
  check("정리: 업무를 지우면 이력도 남지 않는다", await prisma.taskEvent.count({ where: { taskId: task.id } }), 0)
  await prisma.$disconnect()
}

console.log(fail ? `\n✗ ${fail}건 실패` : "\n✓ 전부 통과")
process.exit(fail ? 1 : 0)
