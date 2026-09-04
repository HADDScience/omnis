import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { contactCreateSchema, nextCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = contactCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }
  const { orgId, ...fields } = parsed.data

  const org = await prisma.crmOrg.findUnique({ where: { id: orgId } })
  if (!org) return NextResponse.json({ error: "기관을 찾을 수 없습니다" }, { status: 404 })

  const contact = await createWithUniqueCode(async () => {
    const codes = (await prisma.crmContact.findMany({ select: { code: true } })).map((c) => c.code)
    return prisma.crmContact.create({
      data: { ...fields, code: nextCode("CT", codes), org: { connect: { id: orgId } } },
    })
  })
  return NextResponse.json(contact, { status: 201 })
}
