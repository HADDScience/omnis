import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { writeActivity } from "@/lib/api"
import { deleteProduction, updateProduction } from "@/lib/crm-ops"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ productionId: string }> }

/** 생산 고치기 — 팝업이 생산 전체를 보낸다. 그 생산의 장부 줄을 다시 만들어 재고 · 원재료 차감이 다시 계산된다(lib/crm-ops.ts updateProduction, AI 도구 update_production 과 같다) */
export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { productionId } = await params

  const r = await updateProduction(productionId, await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  await writeActivity({
    userId: session.user.id, action: "update", entity: "crm.production", entityId: productionId,
    title: `생산 고침 ${r.value.code} · ${r.value.summary}`,
    metadata: { from: "screen", before: r.value.before, after: r.value.summary, materialGrams: r.value.materialGrams },
  })
  return NextResponse.json(r.value)
}

/** 생산 지우기 — 그 생산에서 나온 장부 줄이 함께 사라져 재고가 생산 전으로 돌아간다(AI 도구 delete_production 과 같다) */
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { productionId } = await params

  const r = await deleteProduction(productionId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  await writeActivity({
    userId: session.user.id, action: "delete", entity: "crm.production", entityId: productionId,
    title: `생산 지움 ${r.value.code} · ${r.value.summary}`,
    metadata: { from: "screen", materialGrams: r.value.materialGrams },
  })
  return NextResponse.json({ ok: true, code: r.value.code })
}
