import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { NotificationPatchSchema } from "@/lib/schemas/notification"
import { respondToAction } from "@/lib/notifications"
import { deleteNotifications, markNotificationsRead } from "@/lib/notification-manage"

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
    await markNotificationsRead(session.user.id, { all: true })
    return NextResponse.json({ ok: true })
  }

  if ("response" in body) {
    const r = await respondToAction(session.user.id, session.user.name ?? "담당자", body.id, body.response)
    return "error" in r ? NextResponse.json({ error: r.error }, { status: r.code }) : NextResponse.json(r)
  }

  const result = await markNotificationsRead(session.user.id, { id: body.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true })
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
  // 지우는 규칙(응답 대기는 남긴다)은 lib/notification-manage.ts — 도구 manage_notifications 와 같다
  if (deleteAll || id) {
    const r = await deleteNotifications(session.user.id, deleteAll ? { all: true } : { id: id! })
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "id 또는 all 필수" }, { status: 400 })
}
