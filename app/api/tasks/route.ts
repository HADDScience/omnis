import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { normalizeName } from "@/lib/name-match"
import type { Prisma, Priority } from "@/generated/prisma/client"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const { searchParams } = new URL(req.url)
  const ownerId = searchParams.get("ownerId")
  const status = searchParams.get("status")
  const projectId = searchParams.get("projectId")

  const where: Record<string, unknown> = { archived: false }
  if (ownerId) where.ownerId = ownerId
  if (status) where.status = status
  if (projectId) where.projectId = projectId

  // #12: TaskCategory 폐기. category include/filter 제거.
  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, name: true } },
      instructor: { select: { id: true, name: true } },
      checklists: { orderBy: { createdAt: "asc" } },
      project: {
        select: {
          id: true,
          name: true,
          product: { select: { id: true, name: true, color: true } },
        },
      },
      _count: { select: { messages: true, files: true } },
    },
  })

  return NextResponse.json(tasks)
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 50)
}

function resolveDeadlineLabel(label: string | null | undefined): Date | null {
  if (!label) return null
  const now = new Date()
  now.setHours(23, 59, 59, 999)
  if (label === "오늘") return now
  if (label === "내일") {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return d
  }
  const dDay = label.match(/^D-(\d+)$/)
  if (dDay) {
    const d = new Date(now)
    d.setDate(d.getDate() + Number(dDay[1]))
    return d
  }
  const iso = label.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 23, 59, 59, 999)
  }
  return null
}

interface CreateTaskBody {
  name?: string
  background?: string
  productId?: string
  priority?: Priority
  sourceMessages?: Prisma.InputJsonValue
  messageIds?: string[]
  ownerId?: string
  checklists?: { name: string }[]
  projectId?: string
  ownerName?: string
  projectName?: string
  deadlineLabel?: string
  checklist?: string[]
  rawCommand?: string
  postToChat?: boolean
  instruction?: string
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return apiError(401, "인증 필요")
  }

  const body = await parseJson<CreateTaskBody>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  // categoryId는 #12로 폐기 (UI/AI 미사용). DB 컬럼은 Phase 4 drop 예정.
  const {
    name,
    background,
    productId,
    priority,
    sourceMessages,
    messageIds,
  } = body
  let { ownerId, checklists, projectId } = body
  const { ownerName, projectName, deadlineLabel, checklist, rawCommand, postToChat, instruction } = body

  // TaskCmdModal에서 이름 기반으로 전달된 경우 ID 해석
  // 존칭("우창님")·약칭("우창")도 흡수 — 완전 일치 우선, 없으면 정규화한 이름의 부분 일치
  if (!ownerId && ownerName?.trim()) {
    const exactName = ownerName.trim()
    const norm = normalizeName(exactName)
    const owner = await prisma.user.findFirst({
      where: norm
        ? { OR: [{ name: exactName }, { name: { contains: norm } }] }
        : { name: exactName },
      select: { id: true },
    })
    if (owner) ownerId = owner.id
  }
  if (!projectId && projectName) {
    const project = await prisma.project.findFirst({
      where: { name: { contains: projectName, mode: "insensitive" }, archived: false },
      select: { id: true },
    })
    if (project) projectId = project.id
  }

  if (!name?.trim() || !ownerId) {
    return apiError(400, "name, ownerId 필수")
  }

  // TaskCmdModal이 보낸 `checklist: string[]` → `checklists: {name}[]` 정규화
  if (!checklists && Array.isArray(checklist)) {
    checklists = checklist.map((n: string) => ({ name: n }))
  }

  const deadline = resolveDeadlineLabel(deadlineLabel)

  // 고유 slug 생성
  let slug = generateSlug(name)
  const existing = await prisma.task.findUnique({ where: { slug } })
  if (existing) slug = `${slug}-${Date.now().toString(36)}`

  const task = await prisma.task.create({
    data: {
      name: name.trim(),
      slug,
      ownerId,
      instructorId: session.user.id,
      projectId: projectId || null,
      productId: productId || null,
      priority: priority || "NORMAL",
      background: background || instruction || null,
      sourceMessages: sourceMessages ?? undefined,
      deadline: deadline || null,
      status: "TODO",
      checklists: checklists?.length
        ? {
            create: checklists.map((cl: { name: string }) => ({
              name: cl.name,
              ownerId,
            })),
          }
        : undefined,
    },
    include: {
      owner: { select: { id: true, name: true } },
      instructor: { select: { id: true, name: true } },
      checklists: true,
    },
  })

  // 업무 지시에 사용된 메시지들 마킹 + 첨부 파일 연결
  if (messageIds?.length) {
    await prisma.chatMessage.updateMany({
      where: { id: { in: messageIds } },
      data: { isTaskInstruction: true, taskId: task.id },
    })

    // 선택된 메시지에 첨부된 파일을 업무에도 연결
    await prisma.file.updateMany({
      where: { messageId: { in: messageIds } },
      data: { taskId: task.id },
    })
  }

  // 담당자에게 알림
  if (ownerId !== session.user.id) {
    await prisma.notification.create({
      data: {
        userId: ownerId,
        type: "task_assigned",
        title: `새 업무: ${task.name}`,
        content: `${session.user.name}님이 업무를 지시했습니다.`,
        entityId: task.id,
      },
    })
  }

  // TaskCmdModal의 postToChat=true → 두 메시지(원본 /업무 + 생성 카드) 게시
  if (postToChat && rawCommand) {
    const roomId = "default-room"
    await prisma.chatRoom.upsert({
      where: { id: roomId },
      update: {},
      create: { id: roomId, name: "하드사이언스 인턴방" },
    })
    const raw = await prisma.chatMessage.create({
      data: {
        roomId,
        authorId: session.user.id,
        content: rawCommand,
        taskId: task.id,
        kind: "NORMAL",
      },
    })
    const card = await prisma.chatMessage.create({
      data: {
        roomId,
        authorId: session.user.id,
        content: `__TASK_CREATED__:${task.id}`,
        taskId: task.id,
        kind: "TASK_CREATED",
      },
    })
    // 멘션 추출
    const { persistMentions } = await import("@/lib/mentions")
    await persistMentions(raw.id, rawCommand).catch(() => {})
    await persistMentions(card.id, `#${task.slug}`).catch(() => {})
  }

  await syncEmbeddingsSafe("TASK", task.id, session.user.id)
  await writeActivity({
    userId: session.user.id,
    action: "task.created",
    entity: "TASK",
    entityId: task.id,
    title: `업무 생성: ${task.name}`,
  })

  return NextResponse.json(task, { status: 201 })
}
