import { NextResponse, type NextRequest } from "next/server"
import { apiError } from "@/lib/api"
import { auth } from "@/lib/auth"
import { sourceMessageFacts } from "@/lib/source-messages"

export const runtime = "nodejs"

/**
 * 옴니스 답의 출처 글(CHAT_MESSAGE) — 바로가기 · 볼 수 있는 첨부 · 첨부 없는 자리표시(lib/source-messages.ts).
 * ?ids=a,b,c. 못 보는 글은 빠진다. components/omnis/source-files.tsx 가 부른다.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  const facts = await sourceMessageFacts(ids, session.user.id)
  return NextResponse.json({ facts }, { headers: { "Cache-Control": "private, no-store" } })
}
