import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { onboardingActionSchema } from "@/lib/schemas/onboarding"
import { publicUrl } from "@/lib/base-path"

const selection = { onboardingVideoSeenAt: true, onboardingCompletedAt: true } as const

async function activeUser() {
  const session = await auth()
  if (!session?.user?.id) return null
  return prisma.user.findFirst({ where: { id: session.user.id, isActive: true }, select: { id: true, ...selection } })
}

export async function GET(request: NextRequest) {
  const user = await activeUser()
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })
  return NextResponse.json({ onboardingVideoSeenAt: user.onboardingVideoSeenAt, onboardingCompletedAt: user.onboardingCompletedAt, mcpUrl: publicUrl("/api/ip-mcp", request.url) }, { headers: { "Cache-Control": "no-store" } })
}

export async function POST(request: NextRequest) {
  // State belongs to the signed-in user; cross-origin requests and extra user IDs are rejected.
  const origin = request.headers.get("origin")
  if (origin && origin !== new URL(publicUrl("/api/onboarding", request.url)).origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 })
  }
  const user = await activeUser()
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })
  const parsed = onboardingActionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "안내 단계가 올바르지 않습니다." }, { status: 400 })
  const now = new Date()
  await prisma.$transaction(async tx => {
    await tx.user.updateMany({ where: { id: user.id, isActive: true, onboardingVideoSeenAt: null }, data: { onboardingVideoSeenAt: now } })
    if (parsed.data.phase === "complete") {
      await tx.user.updateMany({ where: { id: user.id, isActive: true, onboardingCompletedAt: null }, data: { onboardingCompletedAt: now } })
    }
  })
  return NextResponse.json({ ok: true })
}
