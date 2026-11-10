import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import sharp from "sharp"
import { findVisibleFile } from "@/lib/file-access-server"
import { auth } from "@/lib/auth"
import { openFileObject } from "@/lib/file-object"
import { demoStorageBlocked } from "@/lib/demo"
import { NOSNIFF, fileResponseHeaders, safeInlineType } from "@/lib/file-serving"
import { ATTACH_READ_MAX_BYTES } from "@/lib/agent/attachments"

interface Props {
  params: Promise<{ fileId: string }>
}

/** NAS에 있는 실물 파일을 스트리밍한다. NAS는 인터넷에 인증서 없이 열려 있으므로
 *  브라우저가 직접 붙지 않고 반드시 이 라우트를 통과시킨다. */
export async function GET(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const { fileId } = await params
  // 참여자만 보는 방의 파일은 그 방 사람에게만(방을 나가면 더 받지 못한다) — 못 보는 파일도 없는 파일과 같은 404
  const file = await findVisibleFile(fileId, session.user.id)
  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 404 })

  // 썸네일을 만들려면 파일 전체를 메모리에 올린다 — 큰 파일은 열기 전에 돌려보낸다
  const wantsThumb = Number(req.nextUrl.searchParams.get("w")) > 0 && safeInlineType(file.mimeType, file.name)?.startsWith("image/")
  if (wantsThumb && file.size > ATTACH_READ_MAX_BYTES) {
    return NextResponse.json({ error: "파일이 커서 미리보기를 만들지 않습니다" }, { status: 413, headers: NOSNIFF })
  }

  const object = await openFileObject(file, { rangeHeader: req.headers.get("range") })
  if (object.large?.unsatisfiable) {
    return new NextResponse(null, { status: 416, headers: { "Content-Range": object.large.contentRange!, ...NOSNIFF } })
  }

  // ?w=96 — 검색 결과 썸네일. 원본(평균 1.4MB)을 목록에 그대로 띄우면 전송량이 그만큼 나간다
  const w = Number(req.nextUrl.searchParams.get("w"))
  if (wantsThumb) {
    const chunks: Buffer[] = []
    for await (const c of object.body) chunks.push(Buffer.from(c))
    const side = Math.min(Math.max(Math.round(w), 32), 640)
    const thumb = await sharp(Buffer.concat(chunks)).rotate().resize(side, side, { fit: "cover", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
    return new NextResponse(new Uint8Array(thumb), {
      headers: { "Content-Type": "image/webp", ...NOSNIFF, "Cache-Control": file.isPrivate ? "private, no-store" : "private, max-age=86400" },
    })
  }

  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    status: object.large?.contentRange ? 206 : 200,
    headers: {
      ...fileResponseHeaders({ mimeType: file.mimeType, name: file.name }),
      // 큰 첨부만 — 진행률 · 동영상 탐색 · 이어받기. 나머지 파일의 응답은 그대로다
      ...(object.large
        ? {
            "Accept-Ranges": "bytes",
            "Content-Length": String(object.large.contentLength),
            ...(object.large.contentRange ? { "Content-Range": object.large.contentRange } : {}),
          }
        : {}),
      // 참여자만 보는 방의 파일은 저장하지 않는다 — 방을 나간 뒤 브라우저 저장본으로 다시 열리지 않게
      "Cache-Control": file.isPrivate ? "private, no-store" : "private, max-age=3600",
    },
  })
}
