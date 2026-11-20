import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { linkNasFile } from "@/lib/nas-link"

export const runtime = "nodejs"


/**
 * NAS 에 이미 있는 파일을 첨부로 잇는다 — 올리지 않는다(2026-09-17).
 *
 * 4MB 넘는 파일은 Vercel 을 지나 올릴 수 없다. 공용 NAS 에 있는 파일이면 사본을 만들 필요도 없다.
 * 돌려주는 모양은 POST /api/files 와 같다 — 화면은 받은 id 를 메시지에 붙인다.
 * 열람 권한은 /api/nas 와 같다(로그인한 사람 · 허용된 공유폴더 안).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const body = await req.json().catch(() => null)
  // 규칙은 lib/nas-link.ts linkNasFile(도구 link_nas_file 와 같다)
  const r = await linkNasFile(session.user.id, typeof body?.path === "string" ? body.path : "", body?.scope === "private")
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json(r.file, { status: 201 })
}
