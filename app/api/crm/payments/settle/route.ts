import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { settlePayments } from "@/lib/crm-ops"

export const runtime = "nodejs"

const schema = z.object({ invoiceIds: z.array(z.string().min(1)).min(1).max(500) })

/**
 * 입금 기록을 쓰기 시작하기 전에 이미 받은 세금계산서를 한 번에 「받음」 으로 표시한다 (2026-09-17).
 *
 * 입금 기록이 하나도 없으면 2025 년 발행분까지 전부 「590일째 받을 돈」 으로 뜬다 — 첫 화면이 거짓 경보가 된다.
 * 입금일을 지어 넣지 않는다: 발행일로 두고 메모에 「실제 입금일 모름」 을 남긴다. 지우면 되돌아간다.
 * 규칙은 lib/crm-ops.ts settlePayments(도구 settle_payments 와 같다).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "고른 세금계산서가 없습니다" }, { status: 400 })
  const r = await settlePayments(parsed.data.invoiceIds, session.user.id)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ settled: r.value.settled })
}
