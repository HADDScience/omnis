import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import {
  ALLOWED_RESPONSES,
  NotificationActionSchema,
  NotificationPatchSchema,
  type NotificationResponse,
} from "@/lib/schemas/notification"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  // 미해결 액션 알림은 목록 상한(20)에 밀려 사라지면 안 된다 — 응답 전까지 남아야
  // 화면이 대신 재촉한다(인수인계 §4-2). 그래서 따로 뽑아 앞에 붙인다.
  const [pending, recent] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id, actionType: { not: null }, resolvedAt: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ])

  const pendingIds = new Set(pending.map((n) => n.id))
  return NextResponse.json([...pending, ...recent.filter((n) => !pendingIds.has(n.id))])
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const parsed = NotificationPatchSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "id 또는 readAll 필수" }, { status: 400 })
  }
  const body = parsed.data

  if ("readAll" in body) {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data: { read: true },
    })
    return NextResponse.json({ ok: true })
  }

  if ("response" in body) {
    return respondToAction(session.user.id, session.user.name ?? "담당자", body.id, body.response)
  }

  const result = await prisma.notification.updateMany({
    where: { id: body.id, userId: session.user.id },
    data: { read: true },
  })
  if (result.count === 0) {
    return NextResponse.json({ error: "알림 없음" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}

/**
 * 액션 알림에 응답한다.
 *
 * 응답 기록(resolvedAt)을 `resolvedAt: null` 조건부 updateMany 로 먼저 선점해,
 * 더블클릭이나 두 탭에서 동시에 눌러도 부수효과(업무 완료 처리·지시자 알림)가
 * 두 번 일어나지 않게 한다.
 */
async function respondToAction(
  userId: string,
  userName: string,
  notificationId: string,
  response: NotificationResponse
) {
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, userId },
  })
  if (!notification) {
    return NextResponse.json({ error: "알림 없음" }, { status: 404 })
  }

  const action = NotificationActionSchema.safeParse(notification.actionType)
  if (!action.success) {
    return NextResponse.json({ error: "응답할 수 있는 알림이 아닙니다" }, { status: 400 })
  }
  if (!ALLOWED_RESPONSES[action.data].includes(response)) {
    return NextResponse.json({ error: "이 알림에 허용되지 않는 응답입니다" }, { status: 400 })
  }

  const claimed = await prisma.notification.updateMany({
    where: { id: notificationId, userId, resolvedAt: null },
    data: { resolvedAt: new Date(), read: true },
  })
  // 이미 응답한 알림 — 부수효과를 다시 일으키지 않고 조용히 성공 처리한다.
  if (claimed.count === 0) {
    return NextResponse.json({ ok: true, alreadyResolved: true })
  }

  const taskId = notification.entityId
  if (!taskId) return NextResponse.json({ ok: true })

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, slug: true, name: true, instructorId: true, status: true },
  })
  if (!task) return NextResponse.json({ ok: true })

  if (response === "accept") {
    await notifyInstructor(
      task.instructorId,
      userId,
      "task_accepted",
      `업무 확인: ${task.name}`,
      `${userName}님이 #${task.slug} 업무를 확인했습니다.`,
      task.id
    )
    return NextResponse.json({ ok: true })
  }

  if (response === "confirm_done") {
    await prisma.$transaction([
      prisma.task.update({
        where: { id: task.id },
        data: { status: "DONE", workEnd: new Date() },
      }),
      prisma.checklist.updateMany({
        where: { taskId: task.id, done: false },
        data: { done: true },
      }),
    ])
    await notifyInstructor(
      task.instructorId,
      userId,
      "task_status_changed",
      "업무 완료",
      `${userName}님이 #${task.slug} 업무를 완료했습니다.`,
      task.id
    )
    return NextResponse.json({ ok: true, status: "DONE" })
  }

  // defer — 응답 기록만 남긴다. 마감일이 지나면 다시 물어본다.
  return NextResponse.json({ ok: true })
}

async function notifyInstructor(
  instructorId: string,
  actorId: string,
  type: string,
  title: string,
  content: string,
  entityId: string
) {
  if (instructorId === actorId) return
  await prisma.notification.create({
    data: { userId: instructorId, type, title, content, entityId },
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  const deleteAll = searchParams.get("all")

  // 미해결 액션 알림은 지울 수 없다 — 지워서 없애는 길을 열어두면 잔상이 성립하지 않는다.
  const keepPending = { OR: [{ actionType: null }, { resolvedAt: { not: null } }] }

  if (deleteAll) {
    await prisma.notification.deleteMany({
      where: { userId: session.user.id, ...keepPending },
    })
    return NextResponse.json({ ok: true })
  }

  if (id) {
    const result = await prisma.notification.deleteMany({
      where: { id, userId: session.user.id, ...keepPending },
    })
    if (result.count === 0) {
      const exists = await prisma.notification.findFirst({
        where: { id, userId: session.user.id },
        select: { id: true },
      })
      return exists
        ? NextResponse.json({ error: "응답이 필요한 알림은 삭제할 수 없습니다" }, { status: 409 })
        : NextResponse.json({ error: "알림 없음" }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id 또는 all 필수" }, { status: 400 })
}
