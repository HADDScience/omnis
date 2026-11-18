import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { createStockMove, deleteStockMove } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 재고 장부에 한 줄 직접 적는다 — 원료 입고, 폐기, 실사 보정 같은 것. 규칙은 lib/crm-ops.ts(AI 도구 record_stock 과 같다) */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createStockMove(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}

/** 장부 한 줄 지우기. 생산·출고에서 파생된 줄은 그쪽에서 지워야 한다. */
export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const body = z
    .object({ id: z.string().uuid() })
    .safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: "잘못된 입력" }, { status: 400 })

  const r = await deleteStockMove(body.data.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}
