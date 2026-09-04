import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const runtime = "nodejs"

/**
 * 샘플요청을 지운다.
 *
 * 이 요청에서 나간 출고는 남고 연결만 끊긴다 — 보낸 물건은 요청 기록을 지운다고
 * 돌아오지 않는다.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ sampleId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const { sampleId } = await params
  const sample = await prisma.crmSampleRequest.findUnique({
    where: { id: sampleId },
    select: { code: true },
  })
  if (!sample) return NextResponse.json({ error: "샘플요청을 찾을 수 없습니다" }, { status: 404 })

  await prisma.crmSampleRequest.delete({ where: { id: sampleId } })
  return NextResponse.json({ ok: true, code: sample.code })
}
