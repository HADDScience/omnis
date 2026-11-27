// 첫 화면 「지금 할 일」 제안 — 후보 모으기(코드) · 정책대로 AI 순서 · 저장 · 노출/클릭 기록.
// 규칙은 rules.ts 에 있다. 화면(/api/home/suggestions)과 도구(home_suggestions)가 같은 함수를 부른다.
import { Prisma } from "@/generated/prisma"
import { prisma } from "@/lib/db"
import { callGemini } from "@/lib/ai"
import { isHrReviewer } from "@/lib/hr/reviewers"
import { notificationHref } from "@/lib/schemas/notification"
import { sourceHref } from "@/lib/source-facts"
import {
  APPLICATION_DAYS, GRANT_DAYS, HOME_SUGGESTIONS_FEATURE, MENTION_DAYS, SUGGESTION_SCHEMA,
  buildPrompt, candidateHash, codeOrder, decide, parseAiOrder, seoulDay, toItems,
  type Candidate, type RunLite, type SuggestionItem, type Trigger,
} from "./rules"

/** 옴니스 기본 모델 — lib/ai.ts 의 DEFAULT_MODEL 과 같은 값 */
const homeModel = () => process.env.GEMINI_MODEL ?? "gemini-3.6-flash"

/** 서울 날짜의 0시(UTC 시각) */
const seoulMidnight = (day: string) => new Date(`${day}T00:00:00+09:00`)

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** 후보 모으기 — 이 사람이 볼 수 있는 것만. AI 를 부르지 않는다 */
export async function gatherCandidates(userId: string, now = new Date()): Promise<Candidate[]> {
  const today = seoulMidnight(seoulDay(now))
  const dayAfterTomorrow = new Date(today.getTime() + 2 * 86_400_000)
  const [pending, tasks, mentions, grants, hr] = await Promise.all([
    // 1) 응답을 기다리는 알림(업무 수락 · 완료 확인)
    prisma.notification.findMany({
      where: { userId, actionType: { not: null }, resolvedAt: null },
      select: { id: true, type: true, title: true, entityId: true, actionType: true, createdAt: true },
      orderBy: { createdAt: "desc" }, take: 10,
    }),
    // 2) 오늘 · 내일 마감인 내 업무
    prisma.task.findMany({
      where: { archived: false, status: { not: "DONE" }, assignees: { some: { userId } }, deadline: { gte: today, lt: dayAfterTomorrow } },
      select: { id: true, name: true, deadline: true, status: true, updatedAt: true },
      orderBy: { deadline: "asc" }, take: 10,
    }),
    // 3) 나를 부른 글 — 다른 사람이 쓴 것, 그 뒤에 내가 그 방에 쓴 글이 없는 것
    prisma.chatMention.findMany({
      where: { userId, type: "USER", createdAt: { gte: new Date(now.getTime() - MENTION_DAYS * 86_400_000) }, message: { deletedAt: null, authorId: { not: userId } } },
      select: { createdAt: true, message: { select: { id: true, roomId: true, taskId: true, content: true, createdAt: true, author: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" }, take: 10,
    }),
    // 4) 내가 맡은 국가과제 — 준비 중이고 마감이 일주일 안
    prisma.grantDecision.findMany({
      where: { stage: "PREPARING", owners: { some: { userId } }, deadline: { gte: today, lt: new Date(today.getTime() + (GRANT_DAYS + 1) * 86_400_000) } },
      select: { id: true, title: true, deadline: true, updatedAt: true },
      orderBy: { deadline: "asc" }, take: 5,
    }),
    // 5) 새 지원서 — 채용 담당에게만. 지원자 이름은 후보에 넣지 않는다(AI 로 가는 글에 개인정보를 싣지 않는다)
    isHrReviewer(userId).then((ok) => ok
      ? prisma.jobApplication.findMany({
        where: { stage: "RECEIVED", purgedAt: null, receivedAt: { gte: new Date(now.getTime() - APPLICATION_DAYS * 86_400_000) } },
        select: { id: true, jobTitle: true, receivedAt: true }, orderBy: { receivedAt: "desc" },
      })
      : []),
  ])

  const out: Candidate[] = []
  const taskIdsInApprovals = new Set<string>()
  const approvalTasks = await prisma.task.findMany({
    where: { id: { in: pending.map((n) => n.entityId).filter((x): x is string => !!x) } },
    select: { id: true, name: true, deadline: true },
  })
  const taskById = new Map(approvalTasks.map((t) => [t.id, t]))
  for (const n of pending) {
    const t = n.entityId ? taskById.get(n.entityId) : undefined
    if (t) taskIdsInApprovals.add(t.id)
    out.push({
      key: `approval:${n.id}`, kind: "approval",
      title: t?.name ?? n.title,
      detail: n.actionType === "accept_task" ? "업무 수락을 기다립니다" : "완료 확인을 기다립니다",
      due: t?.deadline?.toISOString() ?? null, at: n.createdAt.toISOString(),
      action: { type: "link", href: notificationHref(n.type, n.entityId) ?? "/chat" },
    })
  }
  for (const t of tasks) {
    if (taskIdsInApprovals.has(t.id)) continue
    out.push({
      key: `task_due:${t.id}`, kind: "task_due", title: t.name, detail: "", due: t.deadline!.toISOString(), at: t.updatedAt.toISOString(),
      action: { type: "link", href: `/chat/task/${encodeURIComponent(t.id)}` },
    })
  }
  // 답했는지 — 부른 글 뒤에 내가 그 방에 쓴 글이 있으면 답한 것으로 본다
  const seenMessages = new Set<string>()
  for (const m of mentions) {
    const msg = m.message
    if (seenMessages.has(msg.id)) continue
    seenMessages.add(msg.id)
    const replied = await prisma.chatMessage.count({ where: { roomId: msg.roomId, authorId: userId, deletedAt: null, createdAt: { gt: msg.createdAt } } })
    if (replied > 0) continue
    out.push({
      key: `mention:${msg.id}`, kind: "mention", title: msg.author.name, detail: clip(msg.content.replace(/\s+/g, " ").trim(), 160),
      due: null, at: msg.createdAt.toISOString(),
      action: { type: "link", href: sourceHref(msg) },
    })
  }
  for (const g of grants) {
    out.push({
      key: `grant_due:${g.id}`, kind: "grant_due", title: g.title, detail: "", due: g.deadline!.toISOString(), at: g.updatedAt.toISOString(),
      // 과제는 화면보다 정리가 먼저다 — 누르면 옴니스에게 그 과제의 준비 상황을 묻는다
      action: { type: "ask", prompt: `국가과제 「${g.title}」 준비 상황과 마감 전에 남은 일을 정리해 줘` },
    })
  }
  if (hr.length > 0) {
    const jobs = [...new Set(hr.map((a) => a.jobTitle))]
    out.push({
      // 새 지원서가 늘면 열쇠가 바뀐다 — 후보가 바뀐 것으로 본다
      key: `applications:${hr.length}:${hr[0].id}`, kind: "applications",
      title: `새 지원서 ${hr.length}건`, detail: jobs.slice(0, 3).join(" · "),
      due: null, at: (hr[0].receivedAt ?? now).toISOString(),
      action: { type: "link", href: "/hr/applications" },
    })
  }
  return out
}

export interface HomeSuggestions {
  runId: string | null
  trigger: string | null
  source: "ai" | "code" | null
  items: SuggestionItem[]
  generatedAt: string | null
}

const toLite = (r: { id: string; day: string; source: string; trigger: string; candidateHash: string; createdAt: Date }): RunLite =>
  ({ ...r, source: r.source === "ai" ? "ai" : "code" })

/**
 * 지금 보일 제안. 정책(rules.ts decide)대로 저장된 것을 다시 쓰거나, 코드 순서로 만들거나, AI 로 만든다.
 * 다시 쓸 때도 지금 후보에 없는 카드(이미 끝낸 일)는 뺀다.
 */
export async function getHomeSuggestions(userId: string, now = new Date()): Promise<HomeSuggestions> {
  const candidates = await gatherCandidates(userId, now)
  const hash = candidateHash(candidates)
  const day = seoulDay(now)
  const select = { id: true, day: true, source: true, trigger: true, candidateHash: true, createdAt: true, items: true } as const
  // AI 를 부른 실행 = model 이 적힌 것(성공은 source ai, 실패는 source code + error)
  const [lastAi, lastAttempt, lastAny, userAiToday, companyAiToday] = await Promise.all([
    prisma.homeSuggestionRun.findFirst({ where: { userId, source: "ai" }, orderBy: { createdAt: "desc" }, select }),
    prisma.homeSuggestionRun.findFirst({ where: { userId, model: { not: null } }, orderBy: { createdAt: "desc" }, select }),
    prisma.homeSuggestionRun.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select }),
    prisma.homeSuggestionRun.count({ where: { userId, day, model: { not: null } } }),
    prisma.homeSuggestionRun.count({ where: { day, model: { not: null } } }),
  ])
  const d = decide({
    now, hash, count: candidates.length, lastAi: lastAi && toLite(lastAi), lastAttempt: lastAttempt && toLite(lastAttempt),
    lastAny: lastAny && toLite(lastAny), userAiToday, companyAiToday,
  })

  if (d.kind === "empty") return { runId: null, trigger: null, source: null, items: [], generatedAt: null }
  if (d.kind === "reuse") {
    const run = [lastAi, lastAny].find((r) => r?.id === d.run.id)!
    const live = new Set(candidates.map((c) => c.key))
    return {
      runId: run.id, trigger: run.trigger, source: run.source === "ai" ? "ai" : "code",
      items: (run.items as unknown as SuggestionItem[]).filter((i) => live.has(i.key)),
      generatedAt: run.createdAt.toISOString(),
    }
  }
  if (d.kind === "code") return save(userId, day, d.trigger, "code", hash, candidates, toItems(codeOrder(candidates), now), null, 0, d.reason)
  // 코드 순서 실행은 model 이 비어 있다 — 「부른 수」 에 세지 않는다
  return generate(userId, day, d.trigger, hash, candidates, now)
}

async function generate(userId: string, day: string, trigger: Trigger, hash: string, candidates: Candidate[], now: Date): Promise<HomeSuggestions> {
  const model = homeModel()
  const started = new Date()
  try {
    const { prompt, ids } = buildPrompt(candidates, now)
    const text = await callGemini(prompt, HOME_SUGGESTIONS_FEATURE, userId, 0.2, { model, schema: SUGGESTION_SCHEMA, thinkingLevel: "MINIMAL" })
    const { ordered, lines } = parseAiOrder(text, ids, candidates)
    const cost = await prisma.aiUsage.aggregate({ where: { feature: HOME_SUGGESTIONS_FEATURE, userId, createdAt: { gte: started } }, _sum: { costKrw: true } })
    return save(userId, day, trigger, "ai", hash, candidates, toItems(ordered, now, lines), model, Number(cost._sum.costKrw ?? 0), null)
  } catch (e) {
    // AI 가 실패하면 코드 순서로 보인다. 실패도 「부른 것」 으로 남긴다(model 이 적힌다) — 30분 간격 · 하루 한도에 센다
    return save(userId, day, trigger, "code", hash, candidates, toItems(codeOrder(candidates), now), model, 0, `ai_failed: ${(e as Error).message.slice(0, 200)}`)
  }
}

async function save(
  userId: string, day: string, trigger: Trigger, source: "ai" | "code", hash: string, candidates: Candidate[],
  items: SuggestionItem[], model: string | null, costKrw: number, error: string | null,
): Promise<HomeSuggestions> {
  const run = await prisma.homeSuggestionRun.create({
    data: { userId, day, trigger, source, candidateHash: hash, candidateCount: candidates.length, items: items as unknown as Prisma.InputJsonValue, model, costKrw, error },
    select: { id: true, createdAt: true },
  })
  return { runId: run.id, trigger, source, items, generatedAt: run.createdAt.toISOString() }
}

/** 카드 노출 · 클릭 기록. 같은 실행 · 같은 카드 · 같은 종류는 한 번만 남는다 */
export async function recordSuggestionEvent(userId: string, input: { runId: string; itemKey: string; kind: "impression" | "click" }): Promise<boolean> {
  const run = await prisma.homeSuggestionRun.findUnique({ where: { id: input.runId }, select: { userId: true, trigger: true, source: true, items: true } })
  if (!run || run.userId !== userId) return false
  if (!(run.items as unknown as SuggestionItem[]).some((i) => i.key === input.itemKey)) return false
  await prisma.homeSuggestionEvent.createMany({
    data: [{ runId: input.runId, userId, itemKey: input.itemKey, kind: input.kind, trigger: run.trigger, source: run.source }],
    skipDuplicates: true,
  })
  return true
}
