import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { updateOrg } from "@/lib/crm-ops"

export const runtime = "nodejs"

/** 기관을 고친다. 견적을 쓰다 즉석에서 만든 기관은 유형이 비어 있으므로 여기서 채운다. 규칙은 lib/crm-ops.ts updateOrg */
export async function PATCH(req: Request, { params }: { params: Promise<{ orgId: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { orgId } = await params
  const r = await updateOrg(orgId, await req.json().catch(() => null))
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.value)
}
