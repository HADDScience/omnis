// R2 업로드 라우트의 공통 문 — 켜짐 · 로그인 · 데모 · 세션 서명 · 본인 · R2 세션인지. 하나라도 아니면 응답을 돌려준다
import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { verifyUploadSession, type UploadSession } from "@/lib/large-upload/session"
import { r2Config } from "./server"

export async function r2SessionFrom(req: NextRequest): Promise<{ upload: UploadSession; body: Record<string, unknown> } | NextResponse> {
  // R2 값이 없으면 없는 경로다. 스위치(LARGE_UPLOAD_BACKEND)는 새 세션을 열 때만 본다 — 끄기 전에 연 세션은 끝까지 올리거나 버릴 수 있다
  if (!r2Config()) return NextResponse.json({ error: "없는 경로" }, { status: 404 })
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked as NextResponse
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const upload = verifyUploadSession(body.session)
  // 남의 세션 · 만료된 세션 · Blob 세션은 구별하지 않는다
  if (!upload || upload.userId !== session.user.id || !upload.r2UploadId)
    return NextResponse.json({ error: "이어 올릴 수 없습니다. 처음부터 다시 올려 주세요." }, { status: 410 })
  return { upload, body }
}
