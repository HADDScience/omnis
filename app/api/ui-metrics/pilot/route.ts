import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { loadPilotView, parsePilotFilter } from "@/lib/ui-metrics/pilot-server"

export const runtime = "nodejs"

/** 시범 운영 칸의 값 — /settings/ui-metrics 와 같다. 관리자만. ?person=<userId>&room=<roomId> */
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if ((session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 볼 수 있습니다" }, { status: 403 })
  }
  const filter = parsePilotFilter(Object.fromEntries(new URL(req.url).searchParams))
  return NextResponse.json(await loadPilotView(filter))
}
