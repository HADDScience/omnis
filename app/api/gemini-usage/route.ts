import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import {
  currentGeminiUsageWindow,
  GEMINI_USAGE_LIMITS,
} from "@/lib/gemini-usage"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const today = currentGeminiUsageWindow()
  const userId = session.user.id

  const [teamAggregate, myAggregate] = await Promise.all([
    prisma.geminiUsage.aggregate({
      where: { createdAt: { gte: today } },
      _sum: { totalTokens: true },
      _count: true,
    }),
    prisma.geminiUsage.aggregate({
      where: { createdAt: { gte: today }, userId },
      _sum: { totalTokens: true },
      _count: true,
    }),
  ])

  const teamCalls = teamAggregate._count
  const teamTokens = teamAggregate._sum.totalTokens ?? 0
  const myCalls = myAggregate._count
  const myTokens = myAggregate._sum.totalTokens ?? 0

  const teamCallPct = Math.round((teamCalls / GEMINI_USAGE_LIMITS.dailyCalls) * 100)
  const teamTokenPct = Math.round((teamTokens / GEMINI_USAGE_LIMITS.dailyTokens) * 100)
  const myCallPct = Math.round((myCalls / GEMINI_USAGE_LIMITS.dailyCalls) * 100)
  const myTokenPct = Math.round((myTokens / GEMINI_USAGE_LIMITS.dailyTokens) * 100)

  return NextResponse.json({
    team: {
      calls: teamCalls,
      tokens: teamTokens,
      callPct: teamCallPct,
      tokenPct: teamTokenPct,
      pct: Math.max(teamCallPct, teamTokenPct),
    },
    my: {
      calls: myCalls,
      tokens: myTokens,
      callPct: myCallPct,
      tokenPct: myTokenPct,
      pct: Math.max(myCallPct, myTokenPct),
    },
    limits: {
      ...GEMINI_USAGE_LIMITS,
    },
  })
}
