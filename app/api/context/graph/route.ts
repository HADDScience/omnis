import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { loadNeighborhood } from "@/lib/context-graph"

export const runtime = "nodejs"

/** 대상 하나를 가운데 둔 Context 그래프 — `?node=task:<id>`. LLM 호출 없음 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const key = req.nextUrl.searchParams.get("node")
  if (!key) return NextResponse.json({ error: "node 가 필요합니다" }, { status: 400 })

  const isAdmin = (session.user as { role?: string }).role === "ADMIN"
  const t0 = performance.now()
  const data = await loadNeighborhood(key, { isAdmin })
  if (!data) return NextResponse.json({ error: "찾을 수 없거나 볼 수 없는 대상입니다" }, { status: 404 })
  return NextResponse.json({ ...data, ms: Math.round(performance.now() - t0) })
}
