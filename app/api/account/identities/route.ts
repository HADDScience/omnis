import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { listIdentities, unlinkIdentity } from "@/lib/auth-identity"

/** 내가 연결해 둔 소셜 로그인 수단 목록. */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  return NextResponse.json(await listIdentities(session.user.id))
}

/**
 * 연결 해제. 자기 계정의 연결만 지울 수 있다 —
 * userId를 본문이 아니라 세션에서 가져오므로 남의 연결은 건드릴 수 없다.
 */
export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { provider } = (await req.json()) as { provider?: string }
  if (provider !== "google" && provider !== "kakao") {
    return NextResponse.json({ error: "알 수 없는 제공자입니다" }, { status: 400 })
  }

  const removed = await unlinkIdentity(session.user.id, provider)
  if (!removed) {
    return NextResponse.json({ error: "연결돼 있지 않습니다" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
