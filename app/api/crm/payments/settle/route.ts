import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { writeActivity } from "@/lib/api"
import { SETTLE_NOTE, receivableChains } from "@/lib/crm-receivables"

export const runtime = "nodejs"

const schema = z.object({ invoiceIds: z.array(z.string().min(1)).min(1).max(500) })

/**
 * 입금 기록을 쓰기 시작하기 전에 이미 받은 세금계산서를 한 번에 「받음」 으로 표시한다 (2026-09-17).
 *
 * 입금 기록이 하나도 없으면 2025 년 발행분까지 전부 「590일째 받을 돈」 으로 뜬다 — 첫 화면이 거짓 경보가 된다.
 * 입금일을 지어 넣지 않는다: 발행일로 두고 메모에 「실제 입금일 모름」 을 남긴다. 지우면 되돌아간다.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "고른 세금계산서가 없습니다" }, { status: 400 })

  const want = new Set(parsed.data.invoiceIds)
  const chains = (await receivableChains("SALE")).filter((c) => want.has(c.invoiceId) && c.remaining > 0)
  await prisma.crmPayment.createMany({
    data: chains.map((c) => ({
      invoiceId: c.invoiceId,
      paidOn: new Date(`${c.issuedOn}T00:00:00Z`),
      amountKrw: BigInt(c.remaining),
      note: SETTLE_NOTE,
      createdById: session.user!.id!,
    })),
  })
  await writeActivity({
    userId: session.user.id,
    action: "crm.payment.settled",
    entity: "TAX_INVOICE",
    entityId: null,
    title: `시작 전 정리: ${chains.length}건 받음으로 표시 · ${chains.reduce((a, c) => a + c.remaining, 0).toLocaleString("ko-KR")}원`,
    metadata: { invoiceIds: chains.map((c) => c.invoiceId) },
  })
  return NextResponse.json({ settled: chains.length })
}
