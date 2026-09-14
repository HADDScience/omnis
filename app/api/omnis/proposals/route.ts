import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { apiError, parseJson } from "@/lib/api"
import {
  acceptanceStats,
  applyProposal,
  rejectProposal,
  revertProposal,
} from "@/lib/card-proposals"

export const runtime = "nodejs"

/**
 * AI 가 올린 지식 카드 갱신 제안.
 *
 * GET    목록 + 수락률 통계 (통계가 곧 「언제 자동으로 넘어가나」의 근거다)
 * PATCH  { id, action: "accept" | "reject" | "revert" }
 *
 * 설계: mydocs/plans/2026-09-10-ai-maintained-cards.md
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const status = req.nextUrl.searchParams.get("status") ?? "PENDING"
  const where: Prisma.CardProposalWhereInput =
    status === "all"
      ? {}
      : status === "decided"
        ? { status: { in: ["ACCEPTED", "REJECTED", "AUTO_APPLIED"] } }
        : { status: "PENDING" }

  const [proposals, stats] = await Promise.all([
    prisma.cardProposal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        card: { select: { id: true, title: true, content: true, category: { select: { name: true } } } },
        category: { select: { id: true, name: true } },
        triggerTask: { select: { id: true, name: true, slug: true } },
        decidedBy: { select: { name: true } },
      },
    }),
    acceptanceStats(),
  ])

  return NextResponse.json({ proposals, stats })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const userId = session.user.id

  const body = await parseJson<{ id?: string; action?: string }>(req)
  if (!body?.id || !body.action) return apiError(400, "id, action 필수")

  switch (body.action) {
    case "accept": {
      const r = await applyProposal(body.id, { userId })
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true, cardId: r.cardId, stats: await acceptanceStats() })
    }
    case "reject": {
      const r = await rejectProposal(body.id, userId)
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true, stats: await acceptanceStats() })
    }
    case "revert": {
      const r = await revertProposal(body.id, userId)
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true, stats: await acceptanceStats() })
    }
    default:
      return apiError(400, `지원하지 않는 action: ${body.action}`)
  }
}
