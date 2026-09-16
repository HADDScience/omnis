// 주간보고 — 화면(app/api/reports/weekly)과 MCP(list_weekly_reports · write_weekly_report)가 같은 길을 쓴다.
// 라우트에서 그대로 옮겼다(2026-09-16). 이번 주 업무 수집 · Gemini 초안 · 색인이 여기서 일어난다.
import { startOfWeek, endOfWeek, format } from "date-fns"
import { ko } from "date-fns/locale"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { generateWeeklyReport } from "@/lib/ai"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"

const OWNER = { owner: { select: { id: true, name: true } } } as const

export type WeeklyReportRow = Awaited<ReturnType<typeof listWeeklyReports>>[number]

export function listWeeklyReports(ownerId: string) {
  return prisma.weeklyReport.findMany({
    where: { ownerId },
    orderBy: { weekStart: "desc" },
    include: OWNER,
  })
}

/**
 * 이번 주 보고서를 만들거나 새로 고친다(`ownerId_isoWeek` upsert).
 * 완료·진행 목록은 매번 지금 상태로 다시 센다 — 사람이 쓴 markdown 은 건드리지 않는다.
 */
export async function upsertThisWeekReport(ownerId: string, options: { generateDraft?: boolean } = {}) {
  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const isoWeek = format(now, "yyyy-'W'II", { locale: ko })

  const tasks = await prisma.task.findMany({
    where: {
      assignees: { some: { userId: ownerId } },
      archived: false,
      OR: [
        { createdAt: { gte: weekStart, lte: weekEnd } },
        { updatedAt: { gte: weekStart, lte: weekEnd } },
        { workStart: { gte: weekStart, lte: weekEnd } },
        { workEnd: { gte: weekStart, lte: weekEnd } },
        { deadline: { gte: weekStart, lte: weekEnd } },
      ],
    },
    select: { name: true, status: true },
  })

  const previous = await prisma.weeklyReport.findUnique({
    where: { ownerId_isoWeek: { ownerId, isoWeek } },
    select: { content: true },
  })
  const kept = (previous?.content ?? {}) as Record<string, unknown>

  const content: Record<string, unknown> = {
    ...kept,
    completed: tasks.filter((t) => t.status === "DONE").map((t) => t.name),
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").map((t) => t.name),
    notes: kept.notes ?? "",
    draft: (kept.draft as string) ?? "",
  }

  if (options.generateDraft && process.env.GEMINI_API_KEY) {
    try {
      content.draft = await generateWeeklyReport(tasks, ownerId)
    } catch (err) {
      console.error("[reports/weekly] Gemini 초안 생성 실패", { userId: ownerId, taskCount: tasks.length, err })
    }
  }

  const user = await prisma.user.findUnique({ where: { id: ownerId }, select: { name: true } })
  const title = `${isoWeek} 주간보고 - ${user?.name ?? ""}`

  const report = await prisma.weeklyReport.upsert({
    where: { ownerId_isoWeek: { ownerId, isoWeek } },
    update: { title, weekStart, weekEnd, content: content as Prisma.InputJsonValue },
    create: { title, ownerId, weekStart, weekEnd, isoWeek, content: content as Prisma.InputJsonValue },
    include: OWNER,
  })

  await syncEmbeddingsSafe("WEEKLY_REPORT", report.id, ownerId)
  return report
}

/** 본문(markdown)·상태 수정. 남의 보고서는 찾지 못한 것으로 본다. */
export async function updateWeeklyReport(
  ownerId: string,
  input: { id: string; markdown?: string; status?: string }
): Promise<{ error: string; code: 404 } | { report: Awaited<ReturnType<typeof upsertThisWeekReport>> }> {
  const existing = await prisma.weeklyReport.findFirst({ where: { id: input.id, ownerId } })
  if (!existing) return { error: "보고서 없음", code: 404 }

  const data: Record<string, unknown> = {}
  if (input.markdown !== undefined) {
    data.content = { ...((existing.content ?? {}) as Record<string, unknown>), markdown: input.markdown }
  }
  if (input.status !== undefined) {
    data.status = input.status
    data.submittedAt = input.status === "제출 완료" ? new Date() : null
  }

  const report = await prisma.weeklyReport.update({ where: { id: input.id }, data, include: OWNER })
  await syncEmbeddingsSafe("WEEKLY_REPORT", report.id, ownerId)
  return { report }
}

export async function deleteWeeklyReport(ownerId: string, id: string): Promise<{ ok: true } | { error: string; code: 404 }> {
  const existing = await prisma.weeklyReport.findFirst({ where: { id, ownerId }, select: { id: true } })
  if (!existing) return { error: "보고서 없음", code: 404 }
  await prisma.weeklyReport.delete({ where: { id } })
  await deleteEmbeddingsSafe("WEEKLY_REPORT", id)
  return { ok: true }
}
