import { NextResponse } from "next/server"

import { auth } from "@/lib/auth"
import { loadUiMetricsSummary } from "@/lib/ui-metrics/server"

export const runtime = "nodejs"

/** 배포별 · 사람별 중앙값과 점수. 관리자만 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  if ((session.user as { role?: string }).role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 볼 수 있습니다" }, { status: 403 })
  }
  return NextResponse.json({ deployments: await loadUiMetricsSummary() })
}
