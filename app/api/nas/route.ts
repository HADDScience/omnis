import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import { auth } from "@/lib/auth"
import { listDirectory, readFile, normalizeNasPath, inlineContentType } from "@/lib/nas"

export const runtime = "nodejs"

/**
 * 사내 NAS 열람. 폴더면 목록을, 파일이면 내용을 돌려준다.
 *
 * 브라우저가 NAS 에 직접 붙을 수 없어(자체서명 인증서·Basic 인증·DSM 포트 차단)
 * 옴니스가 중계한다. 로그인한 사람만, 허용된 공유폴더 안만 볼 수 있다.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get("path")
  if (!raw) return NextResponse.json({ error: "path 필수" }, { status: 400 })

  const path = normalizeNasPath(raw)
  if (!path) {
    return NextResponse.json({ error: "열 수 없는 경로입니다" }, { status: 400 })
  }

  // 폴더 먼저 시도한다. 파일이면 PROPFIND 가 목록을 주지 않는다.
  const entries = await listDirectory(path)
  if (entries) {
    return NextResponse.json({ kind: "dir", path, entries })
  }

  const file = await readFile(path)
  if (!file) return NextResponse.json({ error: "찾을 수 없습니다" }, { status: 404 })

  const name = path.split("/").pop() ?? "file"
  const inline = inlineContentType(name)

  return new NextResponse(Readable.toWeb(file.body) as ReadableStream, {
    headers: {
      "Content-Type": inline ?? "application/octet-stream",
      // 브라우저가 열 수 있는 형식이면 그 자리에서 열고, 아니면 저장으로 넘긴다.
      "Content-Disposition":
        `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, max-age=300",
    },
  })
}
