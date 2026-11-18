import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { deleteSampleRequest } from "@/lib/crm-ops"

export const runtime = "nodejs"

/**
 * 샘플요청을 지운다.
 *
 * 이 요청에서 나간 출고는 남고 연결만 끊긴다 — 보낸 물건은 요청 기록을 지운다고
 * 돌아오지 않는다. (AI 도구 delete_sample 은 잘못 적은 기록을 거둘 때 출고까지 함께 지울 수 있다)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sampleId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { sampleId } = await params
  const r = await deleteSampleRequest(sampleId)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ ok: true, code: r.value.code })
}
