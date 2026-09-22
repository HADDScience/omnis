import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { pushConfigured } from "@/lib/push"

/**
 * 웹 푸시 구독 등록·해제.
 *
 * 구독은 사람이 아니라 **기기마다** 하나다 (prisma `PushSubscription` 주석 참조).
 * 같은 endpoint 로 다시 오면 주인만 바꿔 준다 — 한 기기를 두 사람이 번갈아 쓰면
 * 나중에 켠 사람의 것이 된다. 그러지 않으면 unique 충돌로 구독이 아예 안 된다.
 */
const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

/** 화면이 "푸시를 쓸 수 있는 서버인가"를 묻는다. 공개 키가 없으면 구독 버튼을 띄우지 않는다. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const count = await prisma.pushSubscription.count({ where: { userId: session.user.id } })
  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    deviceCount: count,
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const parsed = SubscriptionSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "구독 정보가 올바르지 않습니다" }, { status: 400 })
  }
  const { endpoint, keys } = parsed.data

  const data = {
    userId: session.user.id,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
  }
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, ...data },
    update: data,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const endpoint = new URL(req.url).searchParams.get("endpoint")
  if (!endpoint) {
    return NextResponse.json({ error: "endpoint 필수" }, { status: 400 })
  }

  // 남의 구독은 지우지 못한다 — endpoint 를 알아내도 자기 것만 해제된다.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
