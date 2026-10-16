// 운영 KPI 계산 — 이력으로 세는 지표 · 넣지 말아야 할 지표.
//   npx tsx --env-file=.env scripts/verify-kpi.ts      (로컬 DB 에 시험 업무를 만들고 끝나면 지운다)
//
// 시험 업무는 아주 먼 날(2031-01-07, 한국 시간)에 만들어 다른 기록과 섞이지 않게 한다.
process.env.GEMINI_API_KEY = ""
export {}

const { prisma } = await import("../lib/db")
const { computeDailyKpis, kstDay } = await import("../lib/kpi")

if (!(process.env.DATABASE_URL ?? "").includes("localhost")) throw new Error("로컬 DB 에서만 돈다 — 시험 업무를 만들고 지운다")

let fail = 0
const check = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? "✓" : "✗"} ${label} → ${JSON.stringify(got)}${ok ? "" : ` (기대 ${JSON.stringify(want)})`}`)
}

const DAY = "2031-01-07"
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+09:00`)
const user = await prisma.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } })

const mk = (name: string, createdAt: Date) =>
  prisma.task.create({ data: { name, slug: `verify-kpi-${name}-${Date.now()}`, instructorId: user.id, createdAt, assignees: { create: [{ userId: user.id }] } } })
// 하나는 이틀 전에 생겨 그날 끝나고, 하나는 그날 생겨 끝났다가 AI 가 되돌린다
const t1 = await mk("시험-견본발송", new Date(`2031-01-05T09:00:00+09:00`))
const t2 = await mk("시험-장비점검", at("08:00"))
const ev = (taskId: string, via: string, before: string, after: string, createdAt: Date, actorId: string | null = user.id) =>
  prisma.taskEvent.create({ data: { taskId, actorId, via, field: "status", before, after, createdAt } })

try {
  await ev(t1.id, "web", "IN_PROGRESS", "DONE", at("09:00"))
  await ev(t2.id, "notification", "IN_PROGRESS", "DONE", at("20:00"))
  await ev(t2.id, "chat-ai", "DONE", "IN_PROGRESS", at("21:00"), "system")
  // 경계: 한국 시간 그날 0시 직전과 다음 날 0시는 세지 않는다
  await ev(t1.id, "web", "TODO", "IN_PROGRESS", new Date(`2031-01-06T23:59:59+09:00`))
  await ev(t1.id, "web", "DONE", "REVIEW", new Date(`2031-01-08T00:00:00+09:00`))
  await prisma.chatMessage.create({ data: { roomId: "default-room", authorId: user.id, content: "시험: 견본 발송했습니다", taskId: t1.id, createdAt: at("10:00") } })
  await prisma.chatMessage.create({ data: { roomId: "default-room", authorId: user.id, content: "시험: 점심 뭐 먹죠", createdAt: at("12:00") } })

  const rows = await computeDailyKpis(DAY, { withEvents: true, withSnapshot: false })
  const v = (k: string) => rows.find((r) => r.key === k)
  console.log("── 이력 지표")
  check("상태 변경 3건 · 경로별", [v("tasks.statusChanges")?.value, v("tasks.statusChanges")?.detail], [3, { web: 1, notification: 1, "chat-ai": 1 }])
  check("완료 2건 (되돌린 것도 그날 완료된 사실은 남는다)", [v("tasks.done")?.value, v("tasks.done")?.detail], [2, { web: 1, notification: 1 }])
  check("완료까지 중앙값 — 2일과 0.5일의 가운데 1.25일", v("tasks.leadtime.p50")?.value, 1.25)
  check("다시 열림 1건 · chat-ai", [v("tasks.reopened")?.value, v("tasks.reopened")?.detail], [1, { "chat-ai": 1 }])

  console.log("── 채택 지표")
  check("직접 입력 2건 · 이식 0건", [v("messages.native")?.value, v("messages.imported")?.value], [2, 0])
  check("연결 비율 1/2", v("messages.linkedRate")?.value, 0.5)
  check("그날 직접 쓴 사람 1명", [v("users.active")?.value, v("users.active")?.detail], [1, { names: [user.name] }])
  check("그날 생긴 업무 1건 (이틀 전 것은 아니다)", v("tasks.created.native")?.value, 1)

  console.log("── 넣지 말아야 할 것 (거부)")
  const noEvents = await computeDailyKpis(DAY, { withEvents: false, withSnapshot: false })
  check("거부: 이력 전 날짜에는 이력 지표가 없다 — 0 이 아니라 칸이 없다", noEvents.filter((r) => r.key.startsWith("tasks.done") || r.key.startsWith("tasks.statusChanges") || r.key.startsWith("tasks.reopened")).length, 0)
  check("거부: 상태 스냅샷을 안 넣으면 열린 업무 칸이 없다", rows.some((r) => r.key === "tasks.open"), false)
  const empty = await computeDailyKpis("2031-01-20", { withEvents: true, withSnapshot: false })
  check("거부: 메시지가 없는 날은 연결 비율 칸이 없다 (0% 로 적지 않는다)", empty.some((r) => r.key === "messages.linkedRate"), false)
  check("거부: 완료가 없는 날은 중앙값 칸이 없다", empty.some((r) => r.key === "tasks.leadtime.p50"), false)
  const snap = await computeDailyKpis(DAY, { withEvents: true, withSnapshot: true })
  check("스냅샷을 넣으면 열린 업무 · 조용한 업무 · 체크리스트 남은 완료 세 칸", snap.filter((r) => ["tasks.open", "tasks.stale30", "tasks.doneOpenChecklist"].includes(r.key)).length, 3)

  console.log("── 날짜")
  check("UTC 15시는 한국 다음 날", kstDay(new Date("2031-01-07T15:00:00Z")), "2031-01-08")
  check("UTC 14:59 는 한국 그날", kstDay(new Date("2031-01-07T14:59:59Z")), "2031-01-07")
} finally {
  await prisma.chatMessage.deleteMany({ where: { createdAt: { gte: at("00:00"), lt: at("23:59") }, content: { startsWith: "시험: " } } })
  await prisma.task.deleteMany({ where: { id: { in: [t1.id, t2.id] } } })
  check("정리: 시험 이력이 남지 않는다", await prisma.taskEvent.count({ where: { taskId: { in: [t1.id, t2.id] } } }), 0)
  await prisma.$disconnect()
}

console.log(fail ? `\n✗ ${fail}건 실패` : "\n✓ 전부 통과")
process.exit(fail ? 1 : 0)
