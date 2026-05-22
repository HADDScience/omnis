import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { generateWeeklyReport } from "@/lib/ai"
import { syncEmbeddingsSafe, deleteEmbeddingsSafe } from "@/lib/embeddings"
import { startOfWeek, endOfWeek, format } from "date-fns"
import { ko } from "date-fns/locale"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const reports = await prisma.weeklyReport.findMany({
    where: { ownerId: session.user.id },
    orderBy: { weekStart: "desc" },
    include: { owner: { select: { id: true, name: true } } },
  })
  return NextResponse.json(reports)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { generateDraft } = body

  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })
  const isoWeek = format(now, "yyyy-'W'II", { locale: ko })

  // 이번 주 업무 조회
  const tasks = await prisma.task.findMany({
    where: {
      ownerId: session.user.id,
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

  const content: { completed: string[]; inProgress: string[]; notes: string; draft: string } = {
    completed: tasks.filter((t) => t.status === "DONE").map((t) => t.name),
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").map((t) => t.name),
    notes: "",
    draft: "",
  }

  // Gemini 초안 생성
  if (generateDraft && process.env.GEMINI_API_KEY) {
    try {
      const draft = await generateWeeklyReport(tasks)
      content.draft = draft
    } catch (err) {
      console.error("주간보고 Gemini 오류:", err)
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  })

  const report = await prisma.weeklyReport.upsert({
    where: { ownerId_isoWeek: { ownerId: session.user.id, isoWeek } },
    update: {
      title: `${isoWeek} 주간보고 - ${user?.name ?? ""}`,
      weekStart,
      weekEnd,
      content,
    },
    create: {
      title: `${isoWeek} 주간보고 - ${user?.name ?? ""}`,
      ownerId: session.user.id,
      weekStart,
      weekEnd,
      isoWeek,
      content,
    },
    include: { owner: { select: { id: true, name: true } } },
  })

  await syncEmbeddingsSafe("WEEKLY_REPORT", report.id)

  return NextResponse.json(report, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const body = await req.json()
  const { id, markdown, status } = body

  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const existing = await prisma.weeklyReport.findFirst({ where: { id, ownerId: session.user.id } })
  if (!existing) return NextResponse.json({ error: "보고서 없음" }, { status: 404 })

  const data: Record<string, unknown> = {}

  if (markdown !== undefined) {
    const prevContent = (existing.content ?? {}) as Record<string, unknown>
    data.content = { ...prevContent, markdown }
  }

  if (status !== undefined) {
    data.status = status
    if (status === "제출 완료") data.submittedAt = new Date()
    else data.submittedAt = null
  }

  const updated = await prisma.weeklyReport.update({
    where: { id },
    data,
    include: { owner: { select: { id: true, name: true } } },
  })

  await syncEmbeddingsSafe("WEEKLY_REPORT", updated.id)

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id 필수" }, { status: 400 })

  const existing = await prisma.weeklyReport.findFirst({ where: { id, ownerId: session.user.id }, select: { id: true } })
  if (!existing) return NextResponse.json({ error: "보고서 없음" }, { status: 404 })

  await prisma.weeklyReport.delete({ where: { id } })
  await deleteEmbeddingsSafe("WEEKLY_REPORT", id)
  return NextResponse.json({ ok: true })
}
