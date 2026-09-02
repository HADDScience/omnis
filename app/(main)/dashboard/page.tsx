import { Header } from "@/components/layout/header"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { startOfWeek, subDays } from "date-fns"
import { DashboardView } from "./dashboard-view"
import { DashboardGeminiBadge } from "./dashboard-gemini-usage"
import type { StalledGroups, StalledTask } from "./dashboard-stalled"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()
  const currentUserId = session?.user?.id ?? null

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })

  const [allTasks, users, gajumCard, gwajaeCard, products, allProjects, , geminiAggregate, geminiByEndpoint, pendingActions] = await Promise.all([
    prisma.task.findMany({
      where: { archived: false },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        priority: true,
        ownerId: true,
        deadline: true,
        updatedAt: true,
        productId: true,
        product: { select: { id: true, name: true, color: true } },
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
    prisma.task.findMany({
      where: { status: "DONE", archived: false },
      select: {
        id: true,
        name: true,
        owner: { select: { name: true } },
        category: { select: { name: true } },
        productId: true,
        project: { select: { product: { select: { id: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
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

  const gajumMarkdown = (gajumCard?.content as { text?: string })?.text ?? ""
  const gwajaeMarkdown = (gwajaeCard?.content as { text?: string })?.text ?? ""

  const totalCount = allTasks.length
  const inProgressCount = allTasks.filter((t) => t.status === "IN_PROGRESS").length
  const doneCount = allTasks.filter((t) => t.status === "DONE").length
  const delayedCount = allTasks.filter(
    (t) => t.deadline && new Date(t.deadline) < new Date() && t.status !== "DONE"
  ).length
  const completionRate = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0

  // 기간별 진행률용 업무 데이터
  const tasksForProgress = allTasks.map((t) => ({
    id: t.id,
    status: t.status,
    updatedAt: t.updatedAt.toISOString(),
  }))

  const userStats = users
    .map((u) => {
      const userTasks = allTasks.filter((t) => t.ownerId === u.id)
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

  const serializedTasks = allTasks.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    priority: t.priority,
    ownerId: t.ownerId,
    deadline: t.deadline ? t.deadline.toISOString() : null,
  }))

  // Workspace data
  const workspaceProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
  }))

  const workspaceProjects = allProjects.map((p) => ({
    id: p.id,
    name: p.name,
    productId: p.productId,
    status: "진행 중" as string,
  }))

  // 워크스페이스용 업무 (완료 포함 — 최근 완료 프로젝트 표시용)
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.name]))
  const now = new Date()
  const workspaceTasks = allTasks.map((t) => {
    const deadlineIso = t.deadline ? t.deadline.toISOString() : null
    const isOverdue = !!(t.deadline && t.deadline < now && t.status !== "DONE")
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
      priority: t.priority,
      categoryId: null,
      categoryName: null,
      productId: t.productId ?? t.project?.product?.id ?? null,
      projectId: t.project?.id ?? null,
      projectName: t.project?.name ?? null,
      ownerId: t.ownerId,
      ownerName: userMap[t.ownerId] ?? "?",
      deadline: deadlineIso,
      isOverdue,
      checklistDone: t.checklists.filter((c) => c.done).length,
      checklistTotal: t.checklists.length,
    }
  })

  // 멈춰 있는 업무 — 재촉을 사람이 아니라 화면이 하게 한다(인수인계 §4-2 위반 가시화).
  const STALE_DAYS = 3
  const staleCutoff = subDays(now, STALE_DAYS)
  const taskById = new Map(allTasks.map((t) => [t.id, t]))

  const toStalled = (
    t: (typeof allTasks)[number],
    since: Date
  ): StalledTask => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    ownerName: userMap[t.ownerId] ?? "?",
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

  const geminiUsageData = {
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

  return (
    <>
      <Header title="대시보드" actions={<DashboardGeminiBadge data={geminiUsageData} />} />
      <DashboardView
        stalledGroups={stalledGroups}
        completionRate={completionRate}
        tasksForProgress={tasksForProgress}
        userStats={userStats}
        gajumMarkdown={gajumMarkdown}
        gwajaeMarkdown={gwajaeMarkdown}
        workspaceProducts={workspaceProducts}
        workspaceProjects={workspaceProjects}
        workspaceTasks={workspaceTasks}
      />
    </>
  )
}
