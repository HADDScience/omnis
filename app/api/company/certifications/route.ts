// 인증 후보 올리기 — 아카이브 › 인증 탭의 「후보 올리기」 · 공고 가점표의 「인증 탭 후보로」.
// 같은 이름이 있으면 새로 만들지 않고 그 인증을 돌려준다(existed). 구성원 누구나, 활동 기록에 남는다
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { addCertificationCandidate } from "@/lib/grants"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const body = ((await parseJson(req)) ?? {}) as Record<string, unknown>
  const r = await addCertificationCandidate(session.user.id, {
    name: body.name,
    issuer: body.issuer,
    source: body.source,
  })
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json(r.value, { status: r.value.existed ? 200 : 201 })
}
