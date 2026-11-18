import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createProduction } from "@/lib/crm-ops"

export const runtime = "nodejs"

/**
 * 생산 한 건. 원료를 빼고 완제품을 더한다 — 두 장부가 한 트랜잭션에서 함께 움직인다.
 * 규칙(원료 그램 계산 · 검증)은 lib/crm-ops.ts createProduction(AI 도구 record_production 과 같다).
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createProduction(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}
