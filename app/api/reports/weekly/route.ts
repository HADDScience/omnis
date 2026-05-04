import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { generateWeeklyReport } from "@/lib/ai"
import { startOfWeek, endOfWeek, format } from "date-fns"
import { ko } from "date-fns/locale"

export async function GET() {
  const reports = await prisma.weeklyReport.findMany({
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
    },
    select: { name: true, status: true },
  })

  const content: { completed: string[]; inProgress: string[]; planned: string[]; notes: string; draft: string } = {
    completed: tasks.filter((t) => t.status === "DONE").map((t) => t.name),
    inProgress: tasks.filter((t) => t.status === "IN_PROGRESS").map((t) => t.name),
    planned: [],
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

  const report = await prisma.weeklyReport.create({
    data: {
      title: `${isoWeek} 주간보고 - ${user?.name ?? ""}`,
      ownerId: session.user.id,
      weekStart,
      weekEnd,
      isoWeek,
      content,
    },
    include: { owner: { select: { id: true, name: true } } },
  })

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

  const existing = await prisma.weeklyReport.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "보고서 없음" }, { status: 404 })

  const data: Record<string, unknown> = {}

  if (markdown !== undefined) {
    const prevContent = (existing.content ?? {}) as Record<string, unknown>
    data.content = { ...prevContent, markdown }
  }

  if (status !== undefined) {
    data.status = status
  }

  const updated = await prisma.weeklyReport.update({
    where: { id },
    data,
    include: { owner: { select: { id: true, name: true } } },
  })

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

  await prisma.weeklyReport.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
