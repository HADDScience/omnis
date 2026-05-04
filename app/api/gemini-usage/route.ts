import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { startOfDay } from "date-fns"

const DAILY_CALL_LIMIT = 500
const DAILY_TOKEN_LIMIT = 1_000_000 // 일일 누적 토큰 참고 한도

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const today = startOfDay(new Date())
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

  const teamCallPct = Math.round((teamCalls / DAILY_CALL_LIMIT) * 100)
  const teamTokenPct = Math.round((teamTokens / DAILY_TOKEN_LIMIT) * 100)
  const myCallPct = Math.round((myCalls / DAILY_CALL_LIMIT) * 100)
  const myTokenPct = Math.round((myTokens / DAILY_TOKEN_LIMIT) * 100)

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
      dailyCalls: DAILY_CALL_LIMIT,
      dailyTokens: DAILY_TOKEN_LIMIT,
    },
  })
}
