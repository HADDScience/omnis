import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { apiError, parseJson } from "@/lib/api"
import { restoreOmnisCard } from "@/lib/omnis-card-ops"

export const runtime = "nodejs"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ cardId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")

  const { cardId } = await params
  const body = await parseJson<{ hash?: string }>(req)
  if (!body) return apiError(400, "잘못된 JSON 요청")
  const { hash } = body
  if (!hash) return apiError(400, "hash 필수")

  // 복원 규칙은 lib/omnis-card-ops.ts restoreOmnisCard — omnis/cards/history POST · 도구 restore_omnis_card 와 같다
  const r = await restoreOmnisCard({ id: session.user.id as string, name: session.user.name }, cardId, hash)
  if (!r.ok) return apiError(r.status, r.error)
  return NextResponse.json({ ok: true, content: r.value.content, version: r.value.version })
}
