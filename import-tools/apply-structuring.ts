// 순차 구조화 결과를 업무 카드로 만든다. 라운드 하나치.
//
//   npx tsx import-tools/apply-structuring.ts <라운드번호> [--dry]
//
// 다음 라운드가 이 결과를 맥락으로 받으므로, 라운드마다 적용하고 넘어가야 한다.
import { readFileSync } from "fs"
import { prisma, loadSessions, ROOMS, parseKst, resolveUsers, SPEAKER_TO_USER, normalizeProjectName } from "./kakao-common"

const ROUND = Number(process.argv[2] || 1)
const DRY = process.argv.includes("--dry")
const DIR = `${process.env.HOME}/omnis-import/structure`

/** 과제에 해당하지 않는 일상 업무를 담는 프로젝트. 사용자 결정(2026-09-02). */
const MISC_PROJECT = "기타"

interface Draft {
  id: string; name: string; background?: string; checklist?: string[]
  projectId?: string | null; newProject?: { name: string } | null
  productId?: string | null; priority?: "LOW" | "NORMAL" | "HIGH"
  ownerHints?: string[]; deadlineHint?: string | null
  status?: "TODO" | "IN_PROGRESS" | "DONE"; confidence?: "high" | "low"
}

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"])
const STATUSES = new Set(["TODO", "IN_PROGRESS", "DONE"])

/** 그 라운드 입력에 실렸던 프로젝트 id → 이름. 재시드로 id 가 바뀌어도 이름으로 되짚는다. */
/** 프로젝트 이름 비교용 키. 앞의 날짜·순번 숫자는 무시한다 —
 *  폴더명 정리 규칙이 바뀌면 이름이 달라지기 때문이다("28 IR 피치덱" ↔ "IR 피치덱"). */
function projectKey(name: string): string {
  return normalizeProjectName(name).replace(/^[0-9]+\s+/, "")
}

function readContextProjects(): Map<string, string> {
  const f = `${DIR}/in/round${String(ROUND).padStart(2, "0")}.json`
  const payload = JSON.parse(readFileSync(f, "utf8")) as { context: { projects: { id: string; name: string }[] } }
  return new Map(payload.context.projects.map((p) => [p.id, p.name]))
}

function readDrafts(): Draft[] {
  const f = `${DIR}/out/round${String(ROUND).padStart(2, "0")}.json`
  const raw = readFileSync(f, "utf8").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")
  return JSON.parse(raw)
}

/** 마감일이 세션 시각과 터무니없이 떨어져 있으면 버린다 (환산 오류 방어). */
function sensibleDeadline(iso: string | null | undefined, start: Date): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return null
  const days = (d.getTime() - start.getTime()) / 86400000
  return days >= -3 && days <= 180 ? d : null
}

async function main() {
  const drafts = readDrafts()
  const ctxProjects = readContextProjects()
  const sessions = new Map(loadSessions().filter((s) => ROOMS[s.room]).map((s) => [s.id, s]))
  const userBySpeaker = await resolveUsers()
  const userByName = new Map(
    (await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.name, u.id]),
  )

  const misc = await prisma.project.upsert({
    where: { id: "project-misc" },
    update: {},
    create: { id: "project-misc", name: MISC_PROJECT, status: "진행 중", purpose: "과제에 속하지 않는 상시·일상 업무" },
    select: { id: true },
  })

  const stats = { created: 0, skipped: 0, matched: 0, misc: 0, newProj: 0, noAssignee: 0, deadline: 0, dropped: 0 }

  for (const d of drafts) {
    const s = sessions.get(d.id)
    if (!s) { stats.skipped++; continue }
    const sourceId = `kakao-task:${d.id}`
    if (await prisma.task.findUnique({ where: { sourceId }, select: { id: true } })) { stats.skipped++; continue }

    // 프로젝트: 기존 매칭 → 신규 제안 → 둘 다 없으면 기타
    let projectId: string | null = null
    const byName = new Map(
      (await prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true } }))
        .map((p) => [projectKey(p.name), p.id]),
    )
    // id 가 그대로 살아 있으면 그것을, 아니면 그 라운드 입력의 이름으로 되짚는다.
    const namedFromContext = d.projectId ? ctxProjects.get(d.projectId) : undefined
    const resolvedById = d.projectId && (await prisma.project.findUnique({ where: { id: d.projectId }, select: { id: true } }))
    const resolvedByName = namedFromContext ? byName.get(projectKey(namedFromContext)) : undefined

    if (resolvedById) { projectId = d.projectId!; stats.matched++ }
    else if (resolvedByName) { projectId = resolvedByName; stats.matched++ }
    else if (d.newProject?.name?.trim()) {
      const norm = normalizeProjectName(d.newProject.name)
      const all = await prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true } })
      const hit = all.find((p) => normalizeProjectName(p.name) === norm)
      projectId = hit?.id ?? (await prisma.project.create({ data: { name: d.newProject.name.trim().slice(0, 120), status: "진행 중" }, select: { id: true } })).id
      if (!hit) stats.newProj++
      stats.matched++
    } else {
      projectId = misc.id; stats.misc++
    }

    const assigneeIds = [...new Set((d.ownerHints ?? []).map((n) => userByName.get(n.trim())).filter((v): v is string => !!v))]
    if (assigneeIds.length === 0) stats.noAssignee++

    const instructorSpeaker = s.msgs[0]?.u
    const instructorId = instructorSpeaker ? userBySpeaker.get(instructorSpeaker) : undefined
    if (!instructorId) { stats.skipped++; continue }

    const createdAt = parseKst(s.start)
    const deadline = sensibleDeadline(d.deadlineHint, createdAt)
    if (d.deadlineHint && !deadline) stats.dropped++
    if (deadline) stats.deadline++

    const status = d.status && STATUSES.has(d.status) ? d.status : "TODO"
    const base = (d.name || "업무").toLowerCase().replace(/[^\w가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)
    const items = (d.checklist ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 8)

    if (DRY) { stats.created++; continue }

    await prisma.task.create({
      data: {
        sourceId,
        name: (d.name || "제목 없는 업무").slice(0, 120),
        slug: `${base || "업무"}-${d.id.slice(0, 6)}`,
        instructorId,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
        projectId,
        productId: d.productId ?? null,
        status,
        priority: d.priority && PRIORITIES.has(d.priority) ? d.priority : "NORMAL",
        deadline,
        background: d.background?.trim().slice(0, 2000) || null,
        checklists: { create: items.map((name) => ({ name, done: status === "DONE" })) },
        sourceMessages: {
          source: "kakao", sessionId: d.id, room: s.room, round: ROUND,
          confidence: d.confidence ?? null,
          start: s.start, end: s.end,
          messages: s.msgs.map((m) => ({ t: m.t, u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
        },
        createdAt,
      },
    })
    stats.created++
  }

  console.log(`라운드 ${ROUND} — 생성 ${stats.created} · 건너뜀 ${stats.skipped}`)
  console.log(`  프로젝트  과제 매칭 ${stats.matched} (신규 ${stats.newProj}) · 기타 ${stats.misc}`)
  console.log(`  담당자 없음 ${stats.noAssignee} · 마감일 ${stats.deadline} (버림 ${stats.dropped})`)
  if (DRY) { console.log("  --dry"); await prisma.$disconnect(); return }

  await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = "createdAt" WHERE "sourceId" LIKE 'kakao-task:%'`

  // 이 라운드 세션의 메시지를 업무에 연결한다.
  let linked = 0
  for (const d of drafts) {
    const t = await prisma.task.findUnique({ where: { sourceId: `kakao-task:${d.id}` }, select: { id: true } })
    const s = sessions.get(d.id)
    if (!t || !s) continue
    const { createHash } = await import("crypto")
    const ids = s.msgs.map((m) => `kakao:${createHash("sha1").update(`${s.room}|${m.t}|${m.u}|${m.m}`).digest("hex")}`)
    const { count } = await prisma.chatMessage.updateMany({ where: { sourceId: { in: ids }, taskId: null }, data: { taskId: t.id } })
    linked += count
  }
  console.log(`  메시지 연결 ${linked}건`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
