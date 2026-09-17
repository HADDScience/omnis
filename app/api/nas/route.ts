import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import { auth } from "@/lib/auth"
import { listDirectory, readFile, normalizeNasPath, inlineContentType, statNasFile } from "@/lib/nas"

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

  // ?stat=1 — 파일이면 내용 대신 정보만. 첨부로 고를 때 수백 MB 를 흘리지 않으려고(2026-09-17)
  if (req.nextUrl.searchParams.get("stat") === "1") {
    const entry = await statNasFile(path)
    if (!entry) return NextResponse.json({ error: "찾을 수 없습니다" }, { status: 404 })
    return NextResponse.json({ kind: "file", ...entry })
  }

  // 붙여넣은 경로(NFC)와 맥이 저장한 이름(NFD)이 다르면 바로는 404 다 — statNasFile 이 실제 모양을 찾아 준다(2026-09-17)
  let file = await readFile(path)
  if (!file) {
    const actual = await statNasFile(path)
    if (actual && actual.path !== path) file = await readFile(actual.path)
  }
  if (!file) return NextResponse.json({ error: "찾을 수 없습니다" }, { status: 404 })

  const name = (path.split("/").pop() ?? "file").normalize("NFC")
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
