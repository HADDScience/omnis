import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { finalizeUpload, largeUploadEnabled } from "@/lib/large-upload/server"
import { verifyUploadSession } from "@/lib/large-upload/session"
import { r2Config } from "@/lib/r2/server"
import { finalizeR2Upload } from "@/lib/r2/upload"

/** 올리기 완료 — 크기를 대조하고 첨부로 만든다. 같은 세션으로 다시 불러도 같은 파일을 돌려준다 */
export async function POST(req: NextRequest) {
  if (!largeUploadEnabled() && !r2Config()) return NextResponse.json({ error: "없는 경로" }, { status: 404 })
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const upload = verifyUploadSession(((await req.json().catch(() => null)) as { session?: unknown } | null)?.session)
  if (!upload || upload.userId !== session.user.id) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 올려 주세요." }, { status: 410 })
  if ((upload.r2UploadId && !r2Config()) || (!upload.r2UploadId && !largeUploadEnabled())) return NextResponse.json({ error: "세션이 만료되었습니다. 다시 올려 주세요." }, { status: 410 })
  const result = upload.r2UploadId ? await finalizeR2Upload(upload) : await finalizeUpload(upload)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.file, { status: 201 })
}
