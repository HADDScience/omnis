import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { clientTokenFor, largeUploadEnabled } from "@/lib/large-upload/server"
import { verifyUploadSession } from "@/lib/large-upload/session"

/** 이어 올릴 때 · 토큰이 만료됐을 때 새 토큰을 받는다. 토큰은 기기에 저장하지 않는다 */
export async function POST(req: NextRequest) {
  if (!largeUploadEnabled()) return NextResponse.json({ error: "없는 경로" }, { status: 404 })
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })

  const given = ((await req.json().catch(() => null)) as { session?: unknown } | null)?.session
  const upload = verifyUploadSession(given)
  // 남의 세션 · 만료된 세션은 구별하지 않는다
  if (!upload || upload.userId !== session.user.id) return NextResponse.json({ error: "이어 올릴 수 없습니다. 처음부터 다시 올려 주세요." }, { status: 410 })
  return NextResponse.json({ token: await clientTokenFor(upload, given as string, req.nextUrl.origin) })
}
