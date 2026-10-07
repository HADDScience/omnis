import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { Prisma } from "@/generated/prisma/client"
import { apiError, parseJson } from "@/lib/api"
import {
  acceptRecordProposal,
  loadTypeStats,
  rejectRecordProposal,
  revertRecordProposal,
  type ProposalEdits,
} from "@/lib/record-proposals"

export const runtime = "nodejs"

/**
 * AI 가 채팅 · 업무에서 찾은 연혁 후보.
 *
 * GET    목록 + 종류 × 등급별 정확도 (정확도가 곧 「언제 자동 등록으로 넘어가나」의 근거다)
 * PATCH  { id, action: "accept" | "reject" | "revert", edits? }
 *        accept 에 edits 를 주면 고쳐서 채택한다 — 정확도에서는 원안과 다름으로 센다
 *
 * 연혁은 구성원이면 누구나 남기고 고친다(2026-09-16) — 판단도 같은 범위로 연다.
 * 설계: mydocs/plans/2026-09-30-record-proposals-and-card-categories.md
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const status = req.nextUrl.searchParams.get("status") ?? "PENDING"
  const where: Prisma.RecordProposalWhereInput =
    status === "decided" ? { status: { in: ["ACCEPTED", "REJECTED", "AUTO_APPLIED"] } } : { status: "PENDING" }

  const [proposals, stats, pending] = await Promise.all([
    prisma.recordProposal.findMany({
      where,
      // 확인 대기는 사건 날짜 순으로 — 연혁은 시간 순으로 봐야 빠진 것이 보인다
      orderBy: status === "decided" ? { decidedAt: "desc" } : [{ occurredOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: {
        triggerTask: { select: { id: true, name: true, slug: true } },
        decidedBy: { select: { name: true } },
        record: { select: { id: true, title: true } },
      },
    }),
    loadTypeStats(),
    prisma.recordProposal.count({ where: { status: "PENDING" } }),
  ])

  return NextResponse.json({ proposals, stats, pending })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const userId = session.user.id

  const body = await parseJson<{ id?: string; action?: string; edits?: ProposalEdits }>(req)
  if (!body?.id || !body.action) return apiError(400, "id, action 필수")

  switch (body.action) {
    case "accept": {
      const r = await acceptRecordProposal(body.id, { userId, edits: body.edits })
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true, recordId: r.recordId })
    }
    case "reject": {
      const r = await rejectRecordProposal(body.id, userId)
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true })
    }
    case "revert": {
      const r = await revertRecordProposal(body.id, userId)
      if ("error" in r) return apiError(409, r.error)
      return NextResponse.json({ ok: true })
    }
    default:
      return apiError(400, `지원하지 않는 action: ${body.action}`)
  }
}
