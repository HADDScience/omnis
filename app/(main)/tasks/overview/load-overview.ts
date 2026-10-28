import { startOfWeek, subDays } from "date-fns"
import { prisma } from "@/lib/db"
import { assigneeLabel } from "@/lib/task-assignees"
import type { GeminiUsageData } from "./dashboard-gemini-usage"
import type { StalledGroups, StalledTask } from "./dashboard-stalled"
import type { MemberStat } from "./dashboard-members"

/** 진행 중으로 둔 채 이만큼 움직임이 없으면 「멈춤」 으로 본다 */
const STALE_DAYS = 3

/**
 * 「업무」 탭 한 화면에 필요한 것을 한 번에 읽는다 — 목록·보드·관계도와 그 위 현황 띠.
 *
 * 예전에는 업무 화면과 워크스페이스 화면이 같은 업무 표를 따로 읽었다. 화면을 합치면서
 * 보관 안 된 업무 전체를 한 번 읽고, 목록 필터는 그 위에서 메모리로 거른다 —
 * 「멈춤」 필터는 알림 표와 엮어야 정해져 SQL 한 줄로 쓸 수 없기도 하다.
 */
export async function loadTasksOverview() {
  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })

  const [allTasks, users, gajumCard, gwajaeCard, products, allProjects, geminiAggregate, geminiByEndpoint, pendingActions] = await Promise.all([
    prisma.task.findMany({
      where: { archived: false },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        priority: true,
        deadline: true,
        updatedAt: true,
        instructorId: true,
        productId: true,
        assignees: { select: { user: { select: { id: true, name: true } } } },
        project: {
          select: {
            id: true,
            name: true,
            product: { select: { id: true, name: true, color: true } },
          },
        },
        checklists: { select: { done: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
    prisma.omnisCard.findFirst({ where: { title: "가점항목 리스트" } }),
    prisma.omnisCard.findFirst({ where: { title: "과제 리스트" } }),
    prisma.product.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true, productId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.geminiUsage.aggregate({
      where: { createdAt: { gte: weekStart } },
      _sum: { totalTokens: true, promptTokens: true, candidateTokens: true },
      _count: true,
    }),
    prisma.geminiUsage.groupBy({
      by: ["endpoint"],
      where: { createdAt: { gte: weekStart } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    // 아직 응답이 없는 액션 알림 = 확인 안 한 업무 / 완료 확인 대기의 원천
    prisma.notification.findMany({
      where: { actionType: { in: ["accept_task", "confirm_done"] }, resolvedAt: null },
      select: { entityId: true, actionType: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ])

  const userStats: MemberStat[] = users
    .map((u) => {
      // 담당자가 여러 명이면 각자의 통계에 모두 들어간다
      const userTasks = allTasks.filter((t) => t.assignees.some((a) => a.user.id === u.id))
      return {
        ...u,
        total: userTasks.length,
        inProgress: userTasks.filter((t) => t.status === "IN_PROGRESS").length,
        done: userTasks.filter((t) => t.status === "DONE").length,
        todo: userTasks.filter((t) => t.status === "TODO").length,
        recent: userTasks.slice(0, 5).map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          updatedAt: t.updatedAt.toISOString(),
        })),
        tasksByStatus: {
          IN_PROGRESS: userTasks
            .filter((t) => t.status === "IN_PROGRESS")
            .map((t) => ({ id: t.id, name: t.name, status: t.status })),
          DONE: userTasks
            .filter((t) => t.status === "DONE")
            .slice(0, 10)
            .map((t) => ({ id: t.id, name: t.name, status: t.status })),
          TODO: userTasks
            .filter((t) => t.status === "TODO")
            .map((t) => ({ id: t.id, name: t.name, status: t.status })),
        },
      }
    })
    .filter((u) => u.total > 0)
    // 띠에는 칩이 한 줄로 늘어선다 — 지금 일이 많은 사람이 앞에 오게
    .sort((a, b) => b.inProgress - a.inProgress || b.total - a.total)

  // 멈춰 있는 업무 — 재촉을 사람이 아니라 화면이 하게 한다(인수인계 §4-2 위반 가시화).
  const staleCutoff = subDays(now, STALE_DAYS)
  const taskById = new Map(allTasks.map((t) => [t.id, t]))

  const toStalled = (t: (typeof allTasks)[number], since: Date): StalledTask => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    ownerName: assigneeLabel(t.assignees),
    since: since.toISOString(),
  })

  const stalledGroups: StalledGroups = {
    unacknowledged: [],
    stale: allTasks
      .filter((t) => t.status === "IN_PROGRESS" && t.updatedAt < staleCutoff)
      .map((t) => toStalled(t, t.updatedAt)),
    awaitingDone: [],
  }

  for (const n of pendingActions) {
    const task = n.entityId ? taskById.get(n.entityId) : undefined
    if (!task) continue
    if (n.actionType === "accept_task" && task.status !== "DONE") {
      stalledGroups.unacknowledged.push(toStalled(task, n.createdAt))
    } else if (n.actionType === "confirm_done") {
      stalledGroups.awaitingDone.push(toStalled(task, n.createdAt))
    }
  }

  // 한 업무가 두 갈래(예: 확인 안 함 + 3일째)에 함께 들 수 있다 — 칩 숫자는 업무 수로 센다
  const stalledIds = new Set(
    [...stalledGroups.unacknowledged, ...stalledGroups.stale, ...stalledGroups.awaitingDone].map((t) => t.id)
  )

  const geminiUsage: GeminiUsageData = {
    totalTokens: geminiAggregate._sum.totalTokens ?? 0,
    promptTokens: geminiAggregate._sum.promptTokens ?? 0,
    candidateTokens: geminiAggregate._sum.candidateTokens ?? 0,
    callCount: geminiAggregate._count,
    byEndpoint: geminiByEndpoint.map((e) => ({
      endpoint: e.endpoint,
      totalTokens: e._sum.totalTokens ?? 0,
      callCount: e._count,
    })),
  }

  return {
    now,
    allTasks,
    users,
    userStats,
    stalledGroups,
    stalledIds,
    geminiUsage,
    gajumMarkdown: (gajumCard?.content as { text?: string })?.text ?? "",
    gwajaeMarkdown: (gwajaeCard?.content as { text?: string })?.text ?? "",
    workspaceProducts: products.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    workspaceProjects: allProjects.map((p) => ({
      id: p.id,
      name: p.name,
      productId: p.productId,
      status: "진행 중" as string,
    })),
  }
}

export type TasksOverview = Awaited<ReturnType<typeof loadTasksOverview>>
