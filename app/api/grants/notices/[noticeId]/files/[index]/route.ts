// 공고 첨부 받기 — 원문 사이트의 파일 주소로 보낸다(파일을 옴니스가 들고 있지 않다). 기업마당은 새 토큰을 얻어 보낸다.
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { apiError } from "@/lib/api"
import { attachmentHref } from "@/lib/grants-files"
import type { NoticeAttachment } from "@/lib/grants-import"

export const runtime = "nodejs"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ noticeId: string; index: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) return apiError(401, "인증 필요")
  const { noticeId, index } = await params
  const n = await prisma.grantNotice.findUnique({
    where: { id: noticeId },
    select: { attachments: true },
  })
  const list = (Array.isArray(n?.attachments)
    ? n.attachments
    : []) as unknown as NoticeAttachment[]
  const a = list[Number(index)]
  if (!a) return apiError(404, "없는 첨부입니다")
  return NextResponse.redirect(await attachmentHref(a), 302)
}
