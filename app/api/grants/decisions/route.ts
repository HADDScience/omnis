// 과제 후보(공고)를 「우리 결정」 에 올린다 — 준비 단계, 올린 사람이 담당.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { createDecisionFromNotice } from "@/lib/grants"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = ((await parseJson(req)) ?? {}) as Record<string, unknown>
  if (typeof body.noticeId !== "string" || !body.noticeId)
    return apiError(400, "noticeId 가 필요합니다")
  const r = await createDecisionFromNotice(session.user.id, body.noticeId)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ id: r.value.id }, { status: 201 })
}
