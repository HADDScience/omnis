import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"

interface Props {
  params: Promise<{ taskId: string }>
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { taskId } = await params
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      owner: { select: { id: true, name: true } },
      instructor: { select: { id: true, name: true } },
      checklists: { orderBy: { createdAt: "asc" } },
      messages: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: { id: true, name: true } } },
      },
      project: {
        select: {
          id: true,
          name: true,
          product: { select: { id: true, name: true, color: true } },
        },
      },
    },
  })

  if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다" }, { status: 404 })
  return NextResponse.json(task)
}

export async function PATCH(req: NextRequest, { params }: Props) {
  const { taskId } = await params
  const body = await req.json()
  // categoryId는 #12에서 폐기 (UI/AI 미사용). DB 컬럼은 Phase 4 drop 예정.
  const { status, name, priority, deadline, archived, background, expectedResult, projectId, productId } = body

  const ALLOWED_STATUS = new Set(["TODO", "IN_PROGRESS", "REVIEW", "DONE"])
  if (status !== undefined && !ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: `지원하지 않는 상태 값: ${status}` }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (status !== undefined) data.status = status
  if (name !== undefined) data.name = name
  if (priority !== undefined) data.priority = priority
  if (deadline !== undefined) data.deadline = deadline ? new Date(deadline) : null
  if (archived !== undefined) data.archived = archived
  if (background !== undefined) data.background = background
  if (expectedResult !== undefined) data.expectedResult = expectedResult
  if (projectId !== undefined) data.projectId = projectId
  if (productId !== undefined) data.productId = productId

  // 완료 시 workEnd 설정
  if (status === "DONE") data.workEnd = new Date()
  if (status === "IN_PROGRESS" && !body.workStart) data.workStart = new Date()

  const task = await prisma.task.update({
    where: { id: taskId },
    data,
    include: {
      owner: { select: { id: true, name: true } },
      instructor: { select: { id: true, name: true } },
      checklists: true,
    },
  })

  return NextResponse.json(task)
}

export async function DELETE(_req: NextRequest, { params }: Props) {
  const { taskId } = await params

  await prisma.task.update({
    where: { id: taskId },
    data: { archived: true },
  })

  return NextResponse.json({ ok: true })
}
