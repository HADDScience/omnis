import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { orgCreateSchema, nextCode } from "@/lib/crm"
import { createWithUniqueCode } from "@/lib/crm-server"

export const runtime = "nodejs"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const orgs = await prisma.crmOrg.findMany({
    orderBy: { name: "asc" },
    include: { contacts: { orderBy: { name: "asc" } } },
  })
  return NextResponse.json(orgs)
}

/**
 * 기관을 만든다. 견적을 쓰다가 "없네" 싶을 때 화면을 떠나지 않고 부르는 자리다 —
 * 엑셀에서 기관마스터 시트로 갔다 오던 왕복을 없앤다.
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const parsed = orgCreateSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }

  const dup = await prisma.crmOrg.findUnique({ where: { name: parsed.data.name } })
  if (dup) return NextResponse.json({ error: "같은 이름의 기관이 이미 있습니다", org: dup }, { status: 409 })

  const org = await createWithUniqueCode(async () => {
    const codes = (await prisma.crmOrg.findMany({ select: { code: true } })).map((o) => o.code)
    return prisma.crmOrg.create({ data: { ...parsed.data, code: nextCode("ORG", codes) } })
  })
  return NextResponse.json(org, { status: 201 })
}
