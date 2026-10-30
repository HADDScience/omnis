import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import sharp from "sharp"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { openFileObject } from "@/lib/file-object"
import { demoStorageBlocked } from "@/lib/demo"
import { omnisRoomFileBlocked } from "@/lib/agent/room-files"

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
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, path: true, mimeType: true },
  })
  // 남의 옴니스 1:1 방 파일은 없는 파일과 같다 — lib/agent/room-files.ts
  if (!file || (await omnisRoomFileBlocked(file.id, session.user.id))) return NextResponse.json({ error: "파일 없음" }, { status: 404 })

  const object = await openFileObject(file)

  // ?w=96 — 검색 결과 썸네일. 원본(평균 1.4MB)을 목록에 그대로 띄우면 전송량이 그만큼 나간다
  const w = Number(req.nextUrl.searchParams.get("w"))
  if (w > 0 && file.mimeType.startsWith("image/")) {
    const chunks: Buffer[] = []
    for await (const c of object.body) chunks.push(Buffer.from(c))
    const side = Math.min(Math.max(Math.round(w), 32), 640)
    const thumb = await sharp(Buffer.concat(chunks)).rotate().resize(side, side, { fit: "cover", withoutEnlargement: true }).webp({ quality: 70 }).toBuffer()
    return new NextResponse(new Uint8Array(thumb), {
      headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400" },
    })
  }

  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  })
}
