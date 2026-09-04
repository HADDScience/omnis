import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { orgCreateSchema } from "@/lib/crm"

export const runtime = "nodejs"

/** 기관을 고친다. 견적을 쓰다 즉석에서 만든 기관은 유형이 비어 있으므로 여기서 채운다. */
export async function PATCH(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { orgId } = await params
  const parsed = orgCreateSchema.partial().safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "잘못된 입력" },
      { status: 400 }
    )
  }
  const org = await prisma.crmOrg.update({ where: { id: orgId }, data: parsed.data })
  return NextResponse.json(org)
}
