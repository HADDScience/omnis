import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { searchContext } from "@/lib/context-graph"

export const runtime = "nodejs"

/** Context 그래프의 가운데로 둘 대상 찾기 — 이름 · 제목 일치. 인력(개인정보)은 검색 대상이 아니다 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const results = await searchContext(req.nextUrl.searchParams.get("q") ?? "")
  return NextResponse.json({ results })
}
