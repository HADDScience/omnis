import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { createShipment } from "@/lib/crm-ops"

export const runtime = "nodejs"

/**
 * 출고 한 건. 완제품 재고를 함께 뺀다 — 한 트랜잭션. 재고가 모자라도 막지는 않는다(화면이 빨갛게 알린다).
 * 규칙은 lib/crm-ops.ts createShipment.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createShipment(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}
