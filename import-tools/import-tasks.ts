// Phase B — 업무 세션을 업무 카드로 만든다.
//
//   npx tsx import-tools/import-tasks.ts [--dry]
//
// 규칙만으로 만들 수 있는 것까지만 만든다. 체크리스트·마감일·완료 판정처럼
// 문장을 읽어야 하는 것은 채우지 않는다 — 없는 것을 지어내면 이력이 거짓이 된다.
// (별도 AI 보강 단계에서 얹는다)
import {
  prisma, loadSessions, loadClassified, ROOMS, WORKERS,
  taskSourceId, messageSourceId, parseKst, resolveUsers, SPEAKER_TO_USER,
  normalizeProjectName, type RawSession,
} from "./kakao-common"

const DRY = process.argv.includes("--dry")

/** 업무명. 세션 주제를 그대로 쓴다 — 분류 단계에서 이미 뽑아 둔 값이다. */
const taskName = (topic: string) => topic.trim().slice(0, 120) || "제목 없는 업무"

/**
 * 담당자를 정한다.
 *
 * 지시 시점이 아니라 **세션 전체**를 본다. 채팅에서는 지시가 떨어진 순간엔 담당자가
 * 없어도 뒤이어 누가 받는 경우가 많다.
 *
 * 후보가 여럿이면 한 명을 고르지 않고 전원을 담당자로 넣는다 —
 * "인턴들 각자 ~해주세요" 는 실제로 전원이 담당이다.
 * 후보가 없으면 비워 둔다. 추측해서 채우면 그게 거짓이 된다.
 */
function decideAssignees(s: RawSession): { speakers: string[]; basis: "sole" | "multi" | "none" } {
  const seen: string[] = []
  for (const m of s.msgs) if (WORKERS.has(m.u) && !seen.includes(m.u)) seen.push(m.u)
  return { speakers: seen, basis: seen.length === 1 ? "sole" : seen.length > 1 ? "multi" : "none" }
}

/** 지시자는 그 대화를 연 사람으로 본다. 항상 특정 가능하다. */
const decideInstructor = (s: RawSession) => s.msgs[0]?.u

async function main() {
  const sessions = loadSessions()
  const classified = loadClassified()
  const userBySpeaker = await resolveUsers()

  const targets = sessions.filter((s) => {
    if (!ROOMS[s.room]) return false
    const c = classified.get(s.id)
    return c?.label === "업무" && c.actionable === true
  })

  const stats = { sole: 0, multi: 0, none: 0 }
  const plans = targets.map((s) => {
    const c = classified.get(s.id)!
    const { speakers, basis } = decideAssignees(s)
    stats[basis]++
    return { s, c, speakers, basis }
  })

  console.log(`업무 카드 대상 ${plans.length}개`)
  console.log(`  담당자 단일 ${stats.sole} · 여러 명 ${stats.multi} · 없음 ${stats.none}`)
  const projectNames = [...new Set(plans.map((p) => p.c.project?.trim()).filter((v): v is string => !!v))]
  console.log(`  프로젝트 이름 ${projectNames.length}종 → 정규화 후 ${new Set(projectNames.map(normalizeProjectName)).size}개`)
  if (DRY) {
    for (const p of plans.slice(0, 5)) {
      console.log(`\n  · ${taskName(p.c.topic)}`)
      console.log(`    프로젝트 ${p.c.project || "(없음)"} · 지시 ${decideInstructor(p.s)} · 담당 ${p.speakers.join(", ") || "(미배정)"}`)
    }
    console.log("\n--dry — 쓰지 않고 종료")
    await prisma.$disconnect(); return
  }

  // 프로젝트 먼저 (정규화해서 합친다 — 원본 이름이 조금씩 다르다)
  const projectIdByNorm = new Map<string, string>()
  for (const raw of projectNames) {
    const norm = normalizeProjectName(raw)
    if (projectIdByNorm.has(norm)) continue
    const existing = await prisma.project.findFirst({ where: { archived: false }, select: { id: true, name: true } })
      .then(() => prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true } }))
      .then((all) => all.find((p) => normalizeProjectName(p.name) === norm))
    const id = existing?.id ?? (await prisma.project.create({ data: { name: raw, status: "진행 중" }, select: { id: true } })).id
    projectIdByNorm.set(norm, id)
  }
  console.log(`  프로젝트 ${projectIdByNorm.size}개 준비`)

  let created = 0, skipped = 0
  for (const { s, c, speakers, basis } of plans) {
    const sourceId = taskSourceId(s.id)
    if (await prisma.task.findUnique({ where: { sourceId }, select: { id: true } })) { skipped++; continue }

    const instructorSpeaker = decideInstructor(s)
    const instructorId = instructorSpeaker ? userBySpeaker.get(instructorSpeaker) : undefined
    if (!instructorId) { skipped++; continue }

    const assigneeIds = speakers.map((sp) => userBySpeaker.get(sp)).filter((v): v is string => !!v)
    const norm = c.project?.trim() ? normalizeProjectName(c.project.trim()) : null
    const createdAt = parseKst(s.start)

    // slug 충돌은 세션 id 를 붙여 피한다. 같은 주제가 여러 번 나온다.
    const base = taskName(c.topic).toLowerCase().replace(/[^\w가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)
    const slug = `${base || "업무"}-${s.id.slice(0, 6)}`

    await prisma.task.create({
      data: {
        sourceId,
        name: taskName(c.topic),
        slug,
        instructorId,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        projectId: norm ? projectIdByNorm.get(norm) ?? null : null,
        status: "TODO",
        priority: "NORMAL",
        // deadline 은 채우지 않는다. 원문에 명시된 마감일만 넣어야 하는데
        // 규칙만으로는 알 수 없다. 없는 마감일을 지어내면 전부 "지연"으로 뜬다.
        background: s.msgs.slice(0, 3).map((m) => `${SPEAKER_TO_USER[m.u] ?? m.u}: ${m.m}`).join("\n").slice(0, 2000),
        sourceMessages: {
          source: "kakao",
          sessionId: s.id,
          room: s.room,
          assigneeBasis: basis,
          start: s.start,
          end: s.end,
          messages: s.msgs.map((m) => ({ t: m.t, u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
        },
        createdAt,
      },
    })
    created++
    if (created % 50 === 0) process.stdout.write(`\r  만드는 중 ${created}/${plans.length}`)
  }
  console.log(`\n  새로 만든 업무 ${created}개 · 이미 있던 것 ${skipped}개`)

  // Prisma 가 @updatedAt 을 삽입 시각으로 덮어쓴다. 대시보드가 updatedAt 내림차순으로
  // "최근 업무"를 뽑으므로 교정하지 않으면 1년치가 전부 최근으로 도배된다.
  const fixed = await prisma.$executeRaw`
    UPDATE "Task" SET "updatedAt" = "createdAt" WHERE "sourceId" LIKE 'kakao-session:%'`
  console.log(`  updatedAt 교정 ${fixed}건`)

  // 세션의 메시지를 그 업무에 연결한다 — 업무 카드에서 원본 대화를 그대로 볼 수 있게.
  let linked = 0
  for (const { s } of plans) {
    const task = await prisma.task.findUnique({ where: { sourceId: taskSourceId(s.id) }, select: { id: true } })
    if (!task) continue
    const ids = s.msgs.map((m) => messageSourceId(s.room, m))
    const { count } = await prisma.chatMessage.updateMany({
      where: { sourceId: { in: ids }, taskId: null },
      data: { taskId: task.id },
    })
    linked += count
  }
  console.log(`  업무에 연결한 메시지 ${linked}건`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error("실패:", e); await prisma.$disconnect(); process.exit(1) })
