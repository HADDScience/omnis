import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { deleteTaxInvoice, linkTaxInvoice } from "@/lib/crm-ops"

export const runtime = "nodejs"

const schema = z.object({ quoteId: z.string().min(1).nullable() })

/**
 * 세금계산서를 견적에 잇거나 끊는다 (2026-09-17).
 *
 * 자동으로 못 잇는 흔한 경우가 있다 — 대학은 견적은 학과로, 세금계산서는 산학협력단으로 나간다.
 * 기관이 달라 합계 · 날짜가 맞아도 이어지지 않는다. 견적 화면에서 사람이 한 번 눌러 잇는다.
 * 규칙은 lib/crm-ops.ts linkTaxInvoice(도구 link_tax_invoice 와 같다).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { invoiceId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "잘못된 입력" }, { status: 400 })
  const r = await linkTaxInvoice(invoiceId, parsed.data.quoteId, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true })
}

/**
 * 세금계산서를 지운다 (2026-10-29). 잘못 올렸거나, 취소 뒤 일반 세금계산서로 새로 발행한 경우다.
 *
 * 수정세금계산서는 여기로 오지 않는 게 맞다 — 당초 장을 두고 취소(−) · 재발행(+) 을 올리면 묶인다.
 * 그걸 가르치는 건 지우기 창이 한다(components/crm/invoice-delete-button).
 * NAS 원본 PDF 는 지우지 않는다 — 증빙이고 공용 저장소다. 입금 기록은 스키마대로 함께 지워진다.
 * 규칙은 lib/crm-ops.ts deleteTaxInvoice(도구 delete_tax_invoice 와 같다).
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const { invoiceId } = await params
  const r = await deleteTaxInvoice(invoiceId, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, payments: r.value.payments })
}
