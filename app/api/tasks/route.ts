import { randomBytes } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { createNotification } from "@/lib/notifications"
import { auth } from "@/lib/auth"
import { syncEmbeddingsSafe } from "@/lib/embeddings"
import { apiError, parseJson, writeActivity } from "@/lib/api"
import { normalizeName } from "@/lib/name-match"
import { normalizeProjectName } from "@/lib/project-name"
import { findOrCreateProduct, findOrCreateProject } from "@/lib/project-resolve"
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
  checklists?: { name: string }[]
  projectId?: string
  /** 담당자 이름 배열 (슬래시 명령·AI 초안). 서버가 ID로 해석한다. */
  ownerNames?: string[]
  projectName?: string
  deadlineLabel?: string
  checklist?: string[]
  rawCommand?: string
  postToChat?: boolean
  instruction?: string
  /**
   * 신규 제품·프로젝트 초안. 예전에는 클라이언트가 /api/products → /api/projects → /api/tasks
   * 세 번을 따로 호출해, 마지막이 실패하면 앞의 둘이 고아로 남았다(인수인계 §5-B-2).
   * 여기로 함께 보내면 셋이 한 트랜잭션에서 만들어지고, 실패하면 함께 사라진다.
   */
  newProduct?: { name?: string; color?: string }
  newProject?: { name?: string; purpose?: string; goal?: string }
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
  const { ownerIds, ownerNames, projectName, deadlineLabel, checklist, rawCommand, postToChat, instruction, newProduct, newProject } = body

  // TaskCmdModal에서 이름 기반으로 전달된 경우 ID 해석
  // 존칭("우창님")·약칭("우창")도 흡수 — 완전 일치 우선, 없으면 정규화한 이름의 부분 일치
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
      where: norm ? { OR: [{ name: exactName }, { name: { contains: norm } }] } : { name: exactName },
      select: { id: true },
    })
    if (user && !assigneeIds.includes(user.id)) assigneeIds.push(user.id)
  }
  // 이름으로만 프로젝트가 전달된 경우(현재 UI는 projectId를 보내므로 예비 경로).
  // 예전에는 부분 일치(contains)로 찾았는데, "AI 과제"가 "AI 과제, 과제비 처리"에도 걸리는 등
  // 어느 것이 매칭될지 비결정적이었다. 정규화 후 완전 일치만 인정한다.
  // 못 찾으면 조용히 null로 두지 않고 400으로 알린다 — 사용자는 프로젝트를 지정했다고 믿기 때문.
  if (!projectId && projectName?.trim()) {
    const normalized = normalizeProjectName(projectName)
    const candidates = await prisma.project.findMany({
      where: { archived: false },
      select: { id: true, name: true },
    })
    const matched = candidates.find((c) => normalizeProjectName(c.name) === normalized)
    if (!matched) {
      return apiError(400, `'${projectName.trim()}' 프로젝트를 찾을 수 없습니다. 프로젝트를 먼저 생성해 주세요.`)
    }
    projectId = matched.id
  }

  if (!name?.trim() || assigneeIds.length === 0) {
    return apiError(400, "name, 담당자 최소 1명 필수")
  }

  // TaskCmdModal이 보낸 `checklist: string[]` → `checklists: {name}[]` 정규화
  if (!checklists && Array.isArray(checklist)) {
    checklists = checklist.map((n: string) => ({ name: n }))
  }

  const deadline = resolveDeadlineLabel(deadlineLabel)

  // 고유 slug 생성.
  // 조회 후 삽입(check-then-insert)은 동시 요청에서 둘 다 "없음"을 보고 같은 slug를 넣어
  // Task.slug @unique 위반으로 500이 난다. 유니크 위반을 잡아 접미사를 붙여 재시도한다.
  const baseSlug = generateSlug(name)
  const instructorId = session.user.id

  const wantsNewProduct = !!newProduct?.name?.trim()
  const wantsNewProject = !!newProject?.name?.trim()

  /**
   * 제품 → 프로젝트 → 업무를 한 트랜잭션에서 만든다.
   * 업무 생성이 실패하면 앞서 만든 제품·프로젝트도 함께 롤백된다.
   *
   * slug 유니크 위반(P2002)은 트랜잭션 전체를 중단시키므로, 재시도는
   * 트랜잭션 안이 아니라 **바깥에서** 새 slug로 다시 연다.
   * 롤백된 제품·프로젝트는 다시 만들어도 중복되지 않는다 —
   * findOrCreate* 가 이름으로 멱등하기 때문이다.
   */
  const runCreate = (slug: string) =>
    prisma.$transaction(async (tx) => {
      let finalProductId = productId || null
      let finalProjectId = projectId || null
      let createdProduct: { name: string; reused: boolean } | null = null
      let createdProject: { name: string; reused: boolean } | null = null

      if (wantsNewProduct) {
        const r = await findOrCreateProduct(tx, newProduct!.name!, newProduct!.color ?? null)
        finalProductId = r.product.id
        createdProduct = { name: r.product.name, reused: r.reused }
      }

      if (wantsNewProject) {
        const r = await findOrCreateProject(tx, {
          name: newProject!.name!,
          productId: finalProductId,
          purpose: newProject!.purpose ?? null,
          goal: newProject!.goal ?? null,
        })
        finalProjectId = r.project.id
        createdProject = { name: r.project.name, reused: r.reused }
        // 기존 프로젝트를 재사용했다면 그 프로젝트의 제품을 따른다.
        if (r.reused && r.project.product) finalProductId = r.project.product.id
      }

      const created = await tx.task.create({
        data: {
          name: name.trim(),
          slug,
          assignees: { create: assigneeIds.map((userId) => ({ userId })) },
          instructorId,
          projectId: finalProjectId,
          productId: finalProductId,
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

      return { task: created, createdProduct, createdProject }
    })

  let task
  let createdProduct: { name: string; reused: boolean } | null = null
  let createdProject: { name: string; reused: boolean } | null = null
  for (let attempt = 0; ; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${randomBytes(3).toString("hex")}`
    try {
      const r = await runCreate(slug)
      task = r.task
      createdProduct = r.createdProduct
      createdProject = r.createdProject
      break
    } catch (err) {
      // Prisma는 type-only import이므로 instanceof 대신 코드로 판별한다 (P2002 = 유니크 위반)
      const e = err as { code?: string; meta?: { target?: string[] } }
      const isSlugConflict = e.code === "P2002" && (e.meta?.target?.includes("slug") ?? true)
      if (!isSlugConflict || attempt >= 5) throw err
    }
  }

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

  // 담당자 전원에게 알림 — 수락(확인)하기 전까지 사라지지 않는다.
  // 지시가 도착한 사실만 통보하고 끝내면 "확인 안 한 업무"가 조용히 쌓인다(인수인계 §4-2).
  const instructorName = session.user.name
  for (const userId of assigneeIds.filter((id) => id !== instructorId)) {
    await createNotification(
      userId,
      "task_assigned",
      `새 업무: ${task.name}`,
      `${instructorName}님이 업무를 지시했습니다.`,
      task.id,
      "accept_task"
    )
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

  // 클라이언트가 "신규 프로젝트 생성" 대신 "기존 프로젝트에 연결"이라고
  // 정확히 알릴 수 있도록 무엇을 새로 만들고 무엇을 재사용했는지 함께 돌려준다.
  return NextResponse.json(
    { ...task, _created: { product: createdProduct, project: createdProject } },
    { status: 201 }
  )
}
