import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

/**
 * 「이 기기에서 쓰는 중」 신호. 화면을 만질 때 1분에 한 번까지 온다(components/push-presence.tsx).
 * 사람마다 한 줄을 지금 시각으로 덮는다 — 마지막으로 신호를 보낸 기기가 쓰는 기기다.
 * 푸시가 이것을 어떻게 쓰는지: lib/notify-rules.ts presenceTargets
 */
const PresenceSchema = z.object({
  /** 이 기기의 푸시 구독 endpoint. 구독하지 않은 기기면 없다 */
  endpoint: z.string().url().max(1000).nullish(),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const parsed = PresenceSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "신호가 올바르지 않습니다" }, { status: 400 })
  }

  const data = { activeAt: new Date(), endpoint: parsed.data.endpoint ?? null }
  await prisma.pushPresence.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, ...data },
    update: data,
  })
  return NextResponse.json({ ok: true })
}
