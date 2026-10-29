// 4단계 — 업무·실행가능 세션을 업무 카드로 구조화한다. 라운드마다 준비 → Claude → 반영.
//
// lib/ai.ts 의 structureTask 와 같은 계약을 쓴다. 다른 점은 호출 주체(Gemini → Claude)와
// **순차성**이다. N 라운드는 1..N-1 이 만든 프로젝트·업무를 모두 보고 판단한다.
// 그래야 3월에 생긴 프로젝트에 5월 업무가 붙는다 — 병렬로 돌리면 같은 프로젝트가
// 이름만 다르게 흩어진다.
import { Prisma } from "../../generated/prisma"
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "fs"
import {
  prisma, DATA_DIR, ROOMS, SPEAKER_TO_USER, askClaude, loadClassified, messageSourceId, normalizeProjectName,
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
  /** 이미 있는 업무의 연속이면 그 업무 이름. 새 카드를 만들지 않고 메시지를 그 업무에 붙인다. */
  continuesTask?: string | null
  /**
   * 이 업무에 속하는 메시지의 세션 안 번호. 고른 메시지만 카드에 붙는다.
   * 없으면(이 필드가 생기기 전 캐시) 세션 전체를 붙인다.
   */
  messages?: number[]
  /** 한 세션에서 나온 업무 중 몇 번째인지. 0 이면 sourceId 가 예전과 같다. */
  part?: number
  /** 그 라운드 입력에서 projectId 가 가리키던 이름. 다른 DB(프로덕션)에서 id 가 달라도 이름으로 되짚는다. */
  projectName?: string | null
  round?: number
}

/**
 * Claude 출력 → 세션별 업무 목록.
 *
 * 한 세션에 업무가 섞여 있거나 업무가 없을 수 있어서 출력은 `{id, tasks: [...]}` 다.
 * 예전 출력(세션당 업무 하나, `{id, name, ...}`)도 읽는다 — 감사 자료로 남은 라운드를 되살릴 때.
 */
export function toDraftLists(items: unknown[]): Map<string, Draft[]> {
  const out = new Map<string, Draft[]>()
  for (const it of items as ({ id?: string; tasks?: Draft[] } & Draft)[]) {
    if (!it?.id) continue
    const list = Array.isArray(it.tasks) ? it.tasks : typeof it.name === "string" ? [it] : null
    if (!list) continue
    out.set(it.id, list.filter((d) => d && typeof d.name === "string").map((d, part) => ({ ...d, id: it.id!, part })))
  }
  return out
}

const taskSourceIdOf = (d: Draft) => `kakao-task:${d.id}${d.part ? `#${d.part}` : ""}`

/**
 * 세션별 구조화 결과 캐시.
 *
 * 로컬에서 만들어 눈으로 본 카드와 프로덕션에 들어가는 카드가 **같아야** 한다.
 * Claude 를 다시 부르면 조금씩 다른 카드가 나온다. 그래서 한 번 받은 결과는 세션 id 로
 * 저장해 두고, 어느 DB 에 적용하든 그 결과를 쓴다.
 */
const CACHE = `${DIR}/drafts.json`

export function loadDraftCache(): Map<string, Draft[]> {
  // 값이 배열이 아니면 세션당 업무 하나이던 때의 캐시다.
  if (existsSync(CACHE)) {
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE, "utf8")) as Record<string, Draft | Draft[]>)
      .map(([k, v]) => [k, Array.isArray(v) ? v : [v]]))
  }
  // 캐시가 없으면 지금까지의 라운드 입출력에서 되살린다 (처음 이식 때 손으로 돌린 라운드 포함).
  const cache = new Map<string, Draft[]>()
  if (!existsSync(`${DIR}/out`)) return cache
  for (const f of readdirSync(`${DIR}/out`).filter((x) => /^round\d+\.json$/.test(x)).sort()) {
    const round = Number(f.match(/\d+/)![0])
    const inFile = `${DIR}/in/${f}`
    const ctx = existsSync(inFile)
      ? new Map((JSON.parse(readFileSync(inFile, "utf8")) as { context: { projects: { id: string; name: string }[] } }).context.projects.map((p) => [p.id, p.name]))
      : new Map<string, string>()
    let lists: Map<string, Draft[]>
    try { lists = toDraftLists(parseJsonArray(readFileSync(`${DIR}/out/${f}`, "utf8"))) } catch { continue }
    for (const [id, ds] of lists) cache.set(id, ds.map((d) => ({ ...d, projectName: d.projectId ? ctx.get(d.projectId) ?? null : null, round })))
  }
  saveDraftCache(cache)
  return cache
}
function saveDraftCache(cache: Map<string, Draft[]>) {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(CACHE, JSON.stringify(Object.fromEntries(cache), null, 1))
}

const PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"])
const STATUSES = new Set(["TODO", "IN_PROGRESS", "DONE"])
/** 상태를 올리기만 할 때의 순서. REVIEW 는 사람이 옴니스에서 둔 것이라 DONE 만 그 위다. */
const RANK: Record<string, number> = { TODO: 0, IN_PROGRESS: 1, REVIEW: 2, DONE: 3 }

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

const sessionMessageIds = (s: RawSession) => s.msgs.map((m) => messageSourceId(s.room, m))

/**
 * 세션별로 구조화 결과까지 받은 메시지 수.
 *
 * 라운드 입력(`in/roundNN.json`)에 들어갔고 캐시에 결과가 있는 것만 센다 — 입력만 쓰고
 * Claude 가 실패한 라운드는 받은 게 아니다. 세션 id 의 `@N` 은 N 번째 메시지부터 보낸 뒷부분이다.
 */
function structuredCounts(cache: Map<string, Draft[]>): Map<string, number> {
  const seen = new Map<string, number>()
  if (!existsSync(`${DIR}/in`)) return seen
  for (const f of readdirSync(`${DIR}/in`).filter((x) => /^round\d+\.json$/.test(x))) {
    let sessions: { id: string; messages?: unknown[] }[]
    try { sessions = (JSON.parse(readFileSync(`${DIR}/in/${f}`, "utf8")) as { sessions: typeof sessions }).sessions ?? [] } catch { continue }
    for (const s of sessions) {
      if (!cache.has(s.id)) continue
      const [base, from] = s.id.split("@")
      seen.set(base, Math.max(seen.get(base) ?? 0, Number(from ?? 0) + (s.messages?.length ?? 0)))
    }
  }
  return seen
}

/**
 * 구조화할 업무·실행가능 세션. 시간순.
 *
 * - 처음 보는 세션은 통째로. 자기 카드가 있거나 메시지가 이미 다른 업무에 붙어 있으면(기존 업무의 연속,
 *   또는 라운드 입력이 남지 않은 처음 이식분) 끝난 세션이다.
 * - 구조화한 뒤 메시지가 늘어난 세션은 **늘어난 뒷부분만** `<세션id>@<시작 번호>` 로. 같은 날 대화가
 *   이어지면 세션 id(방|첫 시각)는 그대로라, 이걸 따로 보지 않으면 뒤에 붙은 업무 대화가 카드 없이 남는다.
 */
export async function pendingForStructure(sessions: RawSession[], cache = loadDraftCache()): Promise<RawSession[]> {
  const classified = loadClassified()
  const seen = structuredCounts(cache)
  const done = new Set(
    (await prisma.task.findMany({ where: { sourceId: { startsWith: "kakao-task:" } }, select: { sourceId: true } }))
      .map((t) => t.sourceId!.slice("kakao-task:".length).replace(/#\d+$/, "")),
  )
  const work = sessions.filter((s) => ROOMS[s.room] && classified.get(s.id)?.label === "업무" && classified.get(s.id)?.actionable === true)
  const tails = work
    .filter((s) => (seen.get(s.id) ?? 0) > 0 && s.msgs.length > seen.get(s.id)!)
    .map((s) => {
      const from = seen.get(s.id)!
      const msgs = s.msgs.slice(from)
      return { ...s, id: `${s.id}@${from}`, start: msgs[0].t, n: msgs.length, msgs }
    })
  const candidates = work.filter((s) => !seen.has(s.id) && !done.has(s.id))
  const linked = new Set(
    (await prisma.chatMessage.findMany({ where: { sourceId: { in: candidates.flatMap(sessionMessageIds) }, taskId: { not: null } }, select: { sourceId: true } }))
      .map((m) => m.sourceId),
  )
  return [...candidates.filter((s) => !sessionMessageIds(s).some((id) => linked.has(id))), ...tails]
    .sort((a, b) => a.start.localeCompare(b.start))
}

export async function buildPayload(round: number, totalRounds: number, chunk: RawSession[]) {
  const [projects, products, members, omnisCards, priorTasks] = await Promise.all([
    prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true, product: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    prisma.omnisCard.findMany({ select: { title: true, category: { select: { name: true } } }, take: 60 }),
    // 이미 있는 업무. 이어지는 업무인지, 새 업무인지 판단하는 근거다.
    // 이식으로 만든 것만이 아니라 옴니스에서 직접 만든 것도 넣는다 — 빼면 같은 일로 카드가 한 장 더 생긴다.
    // 끝나지 않은 업무는 오래됐어도 전부 넣는다. 최근 80개만 주면 두 달 전 지시의 완료 보고가 새 카드가 되고
    // 원래 카드는 영영 미완료로 남는다.
    Promise.all([
      prisma.task.findMany({
        where: { archived: false, status: { not: "DONE" } },
        select: { name: true, status: true, createdAt: true, project: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.task.findMany({
        where: { status: "DONE" },
        select: { name: true, status: true, createdAt: true, project: { select: { name: true } } },
        orderBy: { createdAt: "desc" }, take: 40,
      }),
    ]).then(([open, done]) => [...open, ...done]),
  ])
  return {
    round, totalRounds,
    context: {
      projects: projects.map((p) => ({ id: p.id, name: p.name, productName: p.product?.name ?? null })),
      products,
      members: members.map((m) => m.name),
      omnisCards: omnisCards.map((c) => `[${c.category.name}] ${c.title}`),
      priorTasks: priorTasks.map((t) => ({ name: t.name, project: t.project?.name ?? null, date: t.createdAt.toISOString().slice(0, 10), status: t.status })),
    },
    sessions: chunk.map((s) => ({
      id: s.id, start: s.start,
      messages: s.msgs.map((m, i) => ({ i, t: m.t.slice(5, 16), u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
    })),
  }
}

/**
 * 업무가 고른 메시지. 번호가 없으면 세션 전체(예전 캐시), 있으면 범위 안의 것만 시간순으로.
 * 세션 안에서 업무 이야기와 잡담·다른 일이 1~2분 간격으로 섞이므로 세션을 통째로 붙이면 안 된다.
 */
function pickMessages(d: Draft, s: RawSession) {
  if (!Array.isArray(d.messages)) return s.msgs
  return [...new Set(d.messages)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < s.msgs.length)
    .sort((a, b) => a - b)
    .map((i) => s.msgs[i])
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
  const stats = { created: 0, continued: 0, promoted: 0, skipped: 0, matched: 0, misc: 0, newProj: 0, noAssignee: 0, deadline: 0, dropped: 0 }
  const createdIds: string[] = []

  for (const d of drafts) {
    const s = sessions.get(d.id)
    if (!s) { stats.skipped++; continue }
    const sourceId = taskSourceIdOf(d)
    if (await prisma.task.findUnique({ where: { sourceId }, select: { id: true } })) { stats.skipped++; continue }
    // 이미 다른 업무에 붙은 메시지(사람이 옮긴 것 포함)는 빼고 고른다 — 빈 카드나 중복 카드가 생기지 않게.
    const linked = new Set((await prisma.chatMessage.findMany({
      where: { sourceId: { in: pickMessages(d, s).map((m) => messageSourceId(s.room, m)) }, taskId: { not: null } },
      select: { sourceId: true },
    })).map((m) => m.sourceId))
    const picked = pickMessages(d, s).filter((m) => !linked.has(messageSourceId(s.room, m)))
    if (picked.length === 0) { stats.skipped++; continue }
    const pickedIds = picked.map((m) => messageSourceId(s.room, m))

    // 기존 업무의 연속이면 새 카드 대신 그 업무 스레드에 메시지를 붙인다. 이름이 같은 업무가 여럿이면 가장 최근 것.
    // 이름을 못 찾으면 새 카드로 간다 — 붙일 곳을 지어내지 않는다.
    const target = d.continuesTask?.trim()
      ? await prisma.task.findFirst({ where: { name: d.continuesTask.trim() }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } })
      : null
    if (target) {
      await prisma.chatMessage.updateMany({ where: { sourceId: { in: pickedIds }, taskId: null }, data: { taskId: target.id } })
      // 후속 세션이 완료 보고면 기존 카드를 올린다. 올리기만 한다 — 사람이 옴니스에서 바꾼 상태를 되돌리지 않게.
      const next = d.status && STATUSES.has(d.status) ? d.status : null
      if (next && RANK[next] > (RANK[target.status] ?? 99)) {
        await prisma.task.update({ where: { id: target.id }, data: { status: next } })
        if (next === "DONE") await prisma.checklist.updateMany({ where: { taskId: target.id }, data: { done: true } })
        stats.promoted++
      }
      stats.continued++
      continue
    }

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

    const instructorId = userBySpeaker.get(picked[0].u) ?? userBySpeaker.get(s.msgs[0]?.u)
    if (!instructorId) { stats.skipped++; continue }

    const createdAt = parseKst(picked[0].t)
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
        slug: `${base || "업무"}-${d.id.slice(0, 6)}${d.part ? `-${d.part}` : ""}`,
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
          start: picked[0].t, end: picked[picked.length - 1].t,
          messages: picked.map((m) => ({ t: m.t, u: SPEAKER_TO_USER[m.u] ?? m.u, m: m.m })),
        },
        createdAt,
      },
      select: { id: true },
    })
    // 고른 메시지만 업무에 연결한다 — 스레드에서 원문이 보이게. 나머지는 카드 없는 채팅으로 남는다.
    await prisma.chatMessage.updateMany({ where: { sourceId: { in: pickedIds }, taskId: null }, data: { taskId: task.id } })
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
  const cache = loadDraftCache()
  const targets = await pendingForStructure(sessions, cache)
  const totalRounds = Math.ceil(targets.length / SIZE)
  const tailN = targets.filter((s) => s.id.includes("@")).length
  console.log(`  카드 없는 업무 세션 ${targets.length}개${tailN ? ` (그중 늘어난 뒷부분 ${tailN})` : ""} → ${totalRounds}라운드 × ≤${SIZE} · ${opts.model}`)
  if (targets.length === 0 || opts.dry) return { created: 0 }

  const template = readFileSync(`${import.meta.dirname}/../prompts/structure.md`, "utf8")
  mkdirSync(`${DIR}/in`, { recursive: true }); mkdirSync(`${DIR}/out`, { recursive: true })
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
      let lists: Map<string, Draft[]> | null = null
      for (let attempt = 1; attempt <= 2 && !lists; attempt++) {
        try {
          const text = await askClaude(prompt, { model: opts.model })
          writeFileSync(`${DIR}/out/${tag}${attempt > 1 ? `-retry${attempt}` : ""}.json`, text)
          const parsed = toDraftLists(parseJsonArray(text))
          const ids = new Set(fresh.map((s) => s.id))
          for (const id of parsed.keys()) if (!ids.has(id)) parsed.delete(id)
          if (parsed.size < fresh.length * 0.8) throw new Error(`세션 ${fresh.length}개 중 ${parsed.size}개만 돌아왔다`)
          lists = parsed
        } catch (e) {
          console.log(`  ⚠ ${tag} 시도 ${attempt}: ${(e as Error).message.split("\n")[0]}`)
        }
      }
      if (!lists) { console.log(`  ✗ ${tag} 건너뜀 — 다음 실행에서 다시 시도한다`); round++; continue }
      const ctx = new Map(payload.context.projects.map((p) => [p.id, p.name]))
      for (const [id, ds] of lists) cache.set(id, ds.map((d) => ({ ...d, projectName: d.projectId ? ctx.get(d.projectId) ?? null : null, round })))
      saveDraftCache(cache)
      round++
    }

    const drafts = chunk.flatMap((s) => cache.get(s.id) ?? [])
    const st = await applyDrafts(drafts, chunk)
    created += st.created
    console.log(`  적용 — 생성 ${st.created} · 기존 업무에 붙임 ${st.continued} (상태 올림 ${st.promoted}) ·건너뜀 ${st.skipped} · 과제 매칭 ${st.matched} (신규 ${st.newProj}) · 기타 ${st.misc} · 담당자 없음 ${st.noAssignee} · 마감 ${st.deadline} (버림 ${st.dropped})`)
  }
  return { created }
}
