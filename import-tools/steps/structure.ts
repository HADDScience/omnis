// 4단계 — 업무·실행가능 세션을 업무 카드로 구조화한다. 라운드마다 준비 → Claude → 반영.
//
// lib/ai.ts 의 structureTask 와 같은 계약을 쓴다. 다른 점은 호출 주체(Gemini → Claude)와
// **순차성**이다. N 라운드는 1..N-1 이 만든 프로젝트·업무를 모두 보고 판단한다.
// 그래야 3월에 생긴 프로젝트에 5월 업무가 붙는다 — 병렬로 돌리면 같은 프로젝트가
// 이름만 다르게 흩어진다.
import { createHash } from "crypto"
import { Prisma } from "../../generated/prisma"
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs"
import {
  prisma, DATA_DIR, ROOMS, SPEAKER_TO_USER, askClaude, loadClassified, normalizeProjectName,
  parseJsonArray, parseKst, resolveUsers, pad2, type RawSession,
} from "../kakao-common"

const SIZE = 40
const DIR = `${DATA_DIR}/structure`

/** 과제에 해당하지 않는 일상 업무를 담는 프로젝트. 사용자 결정(2026-09-02). */
const MISC_PROJECT = "기타"

interface Draft {
  id: string; name: string; background?: string; checklist?: string[]
  projectId?: string | null; newProject?: { name: string } | null
  productId?: string | null; priority?: "LOW" | "NORMAL" | "HIGH"
  ownerHints?: string[]; deadlineHint?: string | null
  status?: "TODO" | "IN_PROGRESS" | "DONE"; confidence?: "high" | "low"
  /** 그 라운드 입력에서 projectId 가 가리키던 이름. 다른 DB(프로덕션)에서 id 가 달라도 이름으로 되짚는다. */
  projectName?: string | null
  round?: number
}

/**
 * 세션별 구조화 결과 캐시.
 *
 * 로컬에서 만들어 눈으로 본 카드와 프로덕션에 들어가는 카드가 **같아야** 한다.
 * Claude 를 다시 부르면 조금씩 다른 카드가 나온다. 그래서 한 번 받은 결과는 세션 id 로
 * 저장해 두고, 어느 DB 에 적용하든 그 결과를 쓴다.
 */
const CACHE = `${DIR}/drafts.json`

export function loadDraftCache(): Map<string, Draft> {
  if (existsSync(CACHE)) return new Map(Object.entries(JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, Draft>))
  // 캐시가 없으면 지금까지의 라운드 입출력에서 되살린다 (처음 이식 때 손으로 돌린 라운드 포함).
  const cache = new Map<string, Draft>()
  if (!existsSync(`${DIR}/out`)) return cache
  for (const f of readdirSync(`${DIR}/out`).filter((x) => /^round\d+\.json$/.test(x)).sort()) {
    const round = Number(f.match(/\d+/)![0])
    const inFile = `${DIR}/in/${f}`
    const ctx = existsSync(inFile)
      ? new Map((JSON.parse(readFileSync(inFile, "utf8")) as { context: { projects: { id: string; name: string }[] } }).context.projects.map((p) => [p.id, p.name]))
      : new Map<string, string>()
    let drafts: Draft[]
    try { drafts = parseJsonArray<Draft>(readFileSync(`${DIR}/out/${f}`, "utf8")) } catch { continue }
    for (const d of drafts) if (d?.id) cache.set(d.id, { ...d, projectName: d.projectId ? ctx.get(d.projectId) ?? null : null, round })
  }
  saveDraftCache(cache)
  return cache
}
function saveDraftCache(cache: Map<string, Draft>) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache), null, 1))
}

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"])
const STATUSES = new Set(["TODO", "IN_PROGRESS", "DONE"])

/** 프로젝트 이름 비교용 키. 앞의 날짜·순번 숫자는 무시한다("28 IR 피치덱" ↔ "IR 피치덱"). */
const projectKey = (name: string) => normalizeProjectName(name).replace(/^[0-9]+\s+/, "")

/** 마감일이 세션 시각과 터무니없이 떨어져 있으면 버린다 (환산 오류 방어). */
function sensibleDeadline(iso: string | null | undefined, start: Date): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const d = new Date(`${iso}T00:00:00+09:00`)
  if (Number.isNaN(d.getTime())) return null
  const days = (d.getTime() - start.getTime()) / 86400000
  return days >= -3 && days <= 180 ? d : null
}

/** 이미 쓰인 라운드 번호 다음부터 잇는다 — 감사 자료가 덮이지 않게. */
function nextRoundNumber(): number {
  if (!existsSync(`${DIR}/out`)) return 1
  const nums = readdirSync(`${DIR}/out`).map((f) => Number(f.match(/^round(\d+)\.json$/)?.[1] ?? 0))
  return Math.max(0, ...nums) + 1
}

/** 아직 업무 카드가 없는 업무·실행가능 세션. 시간순. */
export async function pendingForStructure(sessions: RawSession[]): Promise<RawSession[]> {
  const classified = loadClassified()
  const done = new Set(
    (await prisma.task.findMany({ where: { sourceId: { startsWith: "kakao-task:" } }, select: { sourceId: true } }))
      .map((t) => t.sourceId!.slice("kakao-task:".length)),
  )
  return sessions
    .filter((s) => ROOMS[s.room] && classified.get(s.id)?.label === "업무" && classified.get(s.id)?.actionable === true && !done.has(s.id))
    .sort((a, b) => a.start.localeCompare(b.start))
}

async function buildPayload(round: number, totalRounds: number, chunk: RawSession[]) {
  const [projects, products, members, omnisCards, priorTasks] = await Promise.all([
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, product: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.omnisCard.findMany({ select: { title: true, category: { select: { name: true } } }, take: 60 }),
    // 앞 라운드까지 만들어진 업무. 이어지는 업무인지, 새 업무인지 판단하는 근거다.
    prisma.task.findMany({
      where: { sourceId: { startsWith: "kakao-task:" } },
      select: { name: true, createdAt: true, project: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 80,
    }),
  ])
  return {
    round, totalRounds,
    context: {
      projects: projects.map((p) => ({ id: p.id, name: p.name, productName: p.product?.name ?? null })),
      products,
      members: members.map((m) => m.name),
      omnisCards: omnisCards.map((c) => `[${c.category.name}] ${c.title}`),
      priorTasks: priorTasks.map((t) => ({ name: t.name, project: t.project?.name ?? null, date: t.createdAt.toISOString().slice(0, 10) })),
    },
    sessions: chunk.map((s) => ({
      id: s.id, start: s.start,
      messages: s.msgs.map((m) => ({ t: m.t.slice(5, 16), u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
    })),
  }
}

async function applyDrafts(drafts: Draft[], chunk: RawSession[]) {
  const sessions = new Map(chunk.map((s) => [s.id, s]))
  const userBySpeaker = await resolveUsers()
  const userByName = new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.name, u.id]))
  const misc = await prisma.project.upsert({
    where: { id: "project-misc" }, update: {},
    create: { id: "project-misc", name: MISC_PROJECT, status: "진행 중", purpose: "과제에 속하지 않는 상시·일상 업무" },
    select: { id: true },
  })
  const stats = { created: 0, skipped: 0, matched: 0, misc: 0, newProj: 0, noAssignee: 0, deadline: 0, dropped: 0 }
  const createdIds: string[] = []

  for (const d of drafts) {
    const s = sessions.get(d.id)
    if (!s) { stats.skipped++; continue }
    const sourceId = `kakao-task:${d.id}`
    if (await prisma.task.findUnique({ where: { sourceId }, select: { id: true } })) { stats.skipped++; continue }

    // 프로젝트: 기존 매칭 → 신규 제안 → 둘 다 없으면 기타
    const all = await prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true } })
    const byKey = new Map(all.map((p) => [projectKey(p.name), p.id]))
    const resolvedById = d.projectId ? all.find((p) => p.id === d.projectId)?.id : undefined
    const resolvedByName = d.projectName ? byKey.get(projectKey(d.projectName)) : undefined
    let projectId: string
    if (resolvedById) { projectId = resolvedById; stats.matched++ }
    else if (resolvedByName) { projectId = resolvedByName; stats.matched++ }
    else if (d.newProject?.name?.trim() || d.projectName) {
      // 신규 제안이거나, id 로도 이름으로도 못 찾은 기존 프로젝트(다른 DB 에서 만든 것) — 이름으로 만든다.
      const wanted = (d.newProject?.name?.trim() || d.projectName!).slice(0, 120)
      const norm = normalizeProjectName(wanted)
      const hit = all.find((p) => normalizeProjectName(p.name) === norm)
      projectId = hit?.id ?? (await prisma.project.create({ data: { name: wanted, status: "진행 중" }, select: { id: true } })).id
      if (!hit) stats.newProj++
      stats.matched++
    } else { projectId = misc.id; stats.misc++ }

    const assigneeIds = [...new Set((d.ownerHints ?? []).map((n) => userByName.get(String(n).trim())).filter((v): v is string => !!v))]
    if (assigneeIds.length === 0) stats.noAssignee++

    const instructorId = userBySpeaker.get(s.msgs[0]?.u)
    if (!instructorId) { stats.skipped++; continue }

    const createdAt = parseKst(s.start)
    const deadline = sensibleDeadline(d.deadlineHint, createdAt)
    if (d.deadlineHint && !deadline) stats.dropped++
    if (deadline) stats.deadline++

    const status = d.status && STATUSES.has(d.status) ? d.status : "TODO"
    const base = (d.name || "업무").toLowerCase().replace(/[^\w가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)
    const items = (d.checklist ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 8)

    const task = await prisma.task.create({
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
          source: "kakao", sessionId: d.id, room: s.room, round: d.round ?? null, confidence: d.confidence ?? null,
          start: s.start, end: s.end,
          messages: s.msgs.map((m) => ({ t: m.t, u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
        },
        createdAt,
      },
      select: { id: true },
    })
    // 이 세션의 메시지를 업무에 연결한다 — 스레드에서 원문이 보이게.
    const ids = s.msgs.map((m) => `kakao:${createHash("sha1").update(`${s.room}|${m.t}|${m.u}|${m.m}`).digest("hex")}`)
    await prisma.chatMessage.updateMany({ where: { sourceId: { in: ids }, taskId: null }, data: { taskId: task.id } })
    createdIds.push(task.id)
    stats.created++
  }

  // Prisma 는 @updatedAt 에 준 값을 무시하고 삽입 시각으로 덮어쓴다.
  // 대시보드가 updatedAt 내림차순으로 "최근"을 뽑으므로 그대로 두면 1년치가 최근으로 도배된다.
  // 이번에 만든 카드만 고친다 — 먼저 이식된 카드를 사람이 손봤다면 그 갱신 시각은 진짜다.
  if (createdIds.length > 0) {
    await prisma.$executeRaw`UPDATE "Task" SET "updatedAt" = "createdAt" WHERE "id" IN (${Prisma.join(createdIds)})`
  }
  return stats
}

export async function structure(sessions: RawSession[], opts: { model: string; dry: boolean }): Promise<{ created: number }> {
  const targets = await pendingForStructure(sessions)
  const totalRounds = Math.ceil(targets.length / SIZE)
  console.log(`  카드 없는 업무 세션 ${targets.length}개 → ${totalRounds}라운드 × ≤${SIZE} · ${opts.model}`)
  if (targets.length === 0 || opts.dry) return { created: 0 }

  const template = readFileSync(`${import.meta.dirname}/../prompts/structure.md`, "utf8")
  mkdirSync(`${DIR}/in`, { recursive: true }); mkdirSync(`${DIR}/out`, { recursive: true })
  const cache = loadDraftCache()
  let created = 0
  let round = nextRoundNumber()

  for (let i = 0; i < targets.length; i += SIZE) {
    const chunk = targets.slice(i, i + SIZE)
    const fresh = chunk.filter((s) => !cache.has(s.id))
    const cachedN = chunk.length - fresh.length
    if (cachedN > 0) console.log(`  캐시에 있는 결과 ${cachedN}개 — Claude 를 다시 부르지 않는다`)

    if (fresh.length > 0) {
      const payload = await buildPayload(round, totalRounds, fresh)
      const tag = `round${pad2(round)}`
      writeFileSync(`${DIR}/in/${tag}.json`, JSON.stringify(payload, null, 1))
      console.log(`  ${tag} · 세션 ${fresh.length}개 (${fresh[0].start.slice(0, 10)} ~ ${fresh[fresh.length - 1].start.slice(0, 10)}) · 맥락: 프로젝트 ${payload.context.projects.length} · 앞선 업무 ${payload.context.priorTasks.length}`)

      const prompt = template.replace("{{COUNT}}", String(fresh.length)).replace("{{INPUT}}", JSON.stringify(payload))
      let drafts: Draft[] | null = null
      for (let attempt = 1; attempt <= 2 && !drafts; attempt++) {
        try {
          const text = await askClaude(prompt, { model: opts.model })
          writeFileSync(`${DIR}/out/${tag}${attempt > 1 ? `-retry${attempt}` : ""}.json`, text)
          const parsed = parseJsonArray<Draft>(text)
          const ids = new Set(fresh.map((s) => s.id))
          const valid = parsed.filter((d) => d && ids.has(d.id) && typeof d.name === "string")
          if (valid.length < fresh.length * 0.8) throw new Error(`세션 ${fresh.length}개 중 ${valid.length}개만 돌아왔다`)
          drafts = valid
        } catch (e) {
          console.log(`  ⚠ ${tag} 시도 ${attempt}: ${(e as Error).message.split("\n")[0]}`)
        }
      }
      if (!drafts) { console.log(`  ✗ ${tag} 건너뜀 — 다음 실행에서 다시 시도한다`); round++; continue }
      const ctx = new Map(payload.context.projects.map((p) => [p.id, p.name]))
      for (const d of drafts) cache.set(d.id, { ...d, projectName: d.projectId ? ctx.get(d.projectId) ?? null : null, round })
      saveDraftCache(cache)
      round++
    }

    const drafts = chunk.map((s) => cache.get(s.id)).filter((d): d is Draft => !!d)
    const st = await applyDrafts(drafts, chunk)
    created += st.created
    console.log(`  적용 — 생성 ${st.created} · 건너뜀 ${st.skipped} · 과제 매칭 ${st.matched} (신규 ${st.newProj}) · 기타 ${st.misc} · 담당자 없음 ${st.noAssignee} · 마감 ${st.deadline} (버림 ${st.dropped})`)
  }
  return { created }
}
