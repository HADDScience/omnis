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
  // 담당자 필터: 그 사람이 담당자 중 하나인 업무
  if (ownerId) where.assignees = { some: { userId: ownerId } }
  if (status) where.status = status
  if (projectId) where.projectId = projectId

  // #12: TaskCategory 폐기. category include/filter 제거.
  const tasks = await prisma.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      assignees: { select: { user: { select: { id: true, name: true } } } },
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
  /** 담당자 ID 배열. 한 업무를 여러 명이 함께 맡을 수 있다. */
  ownerIds?: string[]
  /** 담당자 이름 배열 (슬래시 명령·AI 초안). 서버가 ID로 해석한다. */
  ownerNames?: string[]
  checklists?: { name: string }[]
  projectId?: string
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
  let { checklists, projectId } = body
  const { ownerIds, ownerNames, projectName, deadlineLabel, checklist, rawCommand, postToChat, instruction } = body

  // 담당자는 여러 명일 수 있다 — "인턴들 각자 ~해주세요" 같은 지시가 흔하다.
  const assigneeIds: string[] = Array.isArray(ownerIds)
    ? ownerIds.filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
    : []

  // 이름으로 전달된 담당자를 ID로 해석 (슬래시 명령·AI 초안).
  // 존칭("우창님")·약칭("우창")도 흡수 — 완전 일치 우선, 없으면 정규화한 이름의 부분 일치
  for (const raw of Array.isArray(ownerNames) ? ownerNames : []) {
    const exactName = String(raw ?? "").trim()
    if (!exactName) continue
    const norm = normalizeName(exactName)
    const user = await prisma.user.findFirst({
      where: norm
        ? { OR: [{ name: exactName }, { name: { contains: norm } }] }
        : { name: exactName },
      select: { id: true },
    })
    if (user && !assigneeIds.includes(user.id)) assigneeIds.push(user.id)
  }
  if (!projectId && projectName) {
    const project = await prisma.project.findFirst({
      where: { name: { contains: projectName, mode: "insensitive" }, archived: false },
      select: { id: true },
    })
    if (project) projectId = project.id
  }

  if (!name?.trim() || assigneeIds.length === 0) {
    return apiError(400, "name, 담당자 최소 1명 필수")
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
      assignees: { create: assigneeIds.map((userId) => ({ userId })) },
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
            create: checklists.map((cl: { name: string }) => ({ name: cl.name })),
          }
        : undefined,
    },
    include: {
      assignees: { select: { user: { select: { id: true, name: true } } } },
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

  // 담당자 전원에게 알림 (스스로에게 지시한 경우는 제외)
  const instructorId = session.user.id
  const instructorName = session.user.name
  const notifyIds = assigneeIds.filter((id) => id !== instructorId)
  if (notifyIds.length > 0) {
    await prisma.notification.createMany({
      data: notifyIds.map((userId) => ({
        userId,
        type: "task_assigned",
        title: `새 업무: ${task.name}`,
        content: `${instructorName}님이 업무를 지시했습니다.`,
        entityId: task.id,
      })),
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
