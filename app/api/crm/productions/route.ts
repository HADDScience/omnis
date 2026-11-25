import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { createProduction } from "@/lib/crm-ops"

export const runtime = "nodejs"

/**
 * 생산 한 건 — 젤 타입 · 농도 · 용량 줄 · 날짜 · 메모 · 사진. 완제품(그 농도)이 늘고 원재료가 준다 — 두 장부가 한 트랜잭션에서 함께 움직인다.
 * 규칙(검사 · 원재료 차감 계산)은 lib/crm-ops.ts createProduction(AI 도구 record_production 과 같다). 원재료가 모자라도 기록하고 warnings 로 알린다.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createProduction(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  await writeActivity({
    userId: session.user.id, action: "create", entity: "crm.production", entityId: r.value.id,
    title: `생산 ${r.value.code} · ${r.value.summary}`,
    metadata: { from: "screen", totalMl: r.value.totalMl, materialGrams: r.value.materialGrams, warnings: r.value.warnings },
  })
  return NextResponse.json(r.value, { status: 201 })
}
