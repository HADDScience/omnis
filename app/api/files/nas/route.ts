import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { normalizeNasPath, statNasFile, inlineContentType } from "@/lib/nas"
import { nasLinkPath } from "@/lib/file-source"

export const runtime = "nodejs"

/** File.size 는 Int(32비트)다. 표시용이라 넘치면 상한으로 적는다. */
const INT_MAX = 2_147_483_647

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
  const path = typeof body?.path === "string" ? normalizeNasPath(body.path) : null
  if (!path) {
    return NextResponse.json({ error: "HADD Science 공유폴더 안의 경로만 연결할 수 있습니다" }, { status: 400 })
  }

  const entry = await statNasFile(path)
  if (!entry) {
    return NextResponse.json({ error: `NAS 에서 파일을 찾지 못했습니다 — ${path}` }, { status: 404 })
  }

  const record = await prisma.file.create({
    data: {
      name: entry.name,
      path: nasLinkPath(path),
      size: Math.min(entry.size ?? 0, INT_MAX),
      // /api/nas 가 그 자리에서 여는 형식이면 그 타입으로 — 말풍선이 이미지 미리보기를 그린다
      mimeType: inlineContentType(entry.name)?.split(";")[0] ?? "application/octet-stream",
    },
  })

  return NextResponse.json(record, { status: 201 })
}
