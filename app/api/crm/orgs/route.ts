import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { createOrg } from "@/lib/crm-ops"

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
 * 엑셀에서 기관마스터 시트로 갔다 오던 왕복을 없앤다. 규칙은 lib/crm-ops.ts createOrg(AI 도구 create_org 와 같다).
 */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const r = await createOrg(await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error, ...r.extra }, { status: r.status })
  return NextResponse.json(r.value, { status: 201 })
}
