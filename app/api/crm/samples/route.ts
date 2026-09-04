import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { CrmSampleStatus } from "@/generated/prisma"
import { nextDatedCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

const createSchema = z.object({
  requestedAt: z.coerce.date(),
  orgId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  productId: z.string().uuid().optional().nullable(),
  request: z.string().trim().max(2000).optional().nullable(),
  referral: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }
  const { orgId, contactId, productId, requestedAt, ...rest } = parsed.data

  const sample = await createWithUniqueCode(async () => {
    const codes = (await prisma.crmSampleRequest.findMany({ select: { code: true } })).map(
      (s) => s.code
    )
    return prisma.crmSampleRequest.create({
      data: {
        ...rest,
        requestedAt,
        code: nextDatedCode(requestedAt, codes),
        org: { connect: { id: orgId } },
        contact: contactId ? { connect: { id: contactId } } : undefined,
        product: productId ? { connect: { id: productId } } : undefined,
      },
    })
  })
  return NextResponse.json(sample, { status: 201 })
}

/** 발송 여부 토글. 목록에서 바로 누를 수 있어야 한다 — 상세로 들어갈 일이 아니다. */
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const body = z
    .object({ id: z.string().uuid(), sent: z.boolean() })
    .safeParse(await req.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: "잘못된 입력" }, { status: 400 })

  const s = await prisma.crmSampleRequest.update({
    where: { id: body.data.id },
    data: {
      status: body.data.sent ? CrmSampleStatus.SENT : CrmSampleStatus.PENDING,
      sentAt: body.data.sent ? new Date() : null,
    },
  })
  return NextResponse.json(s)
}
