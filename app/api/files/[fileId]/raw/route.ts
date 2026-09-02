import { NextRequest, NextResponse } from "next/server"
import { Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth"
import { getObject, objectKeyFor } from "@/lib/storage"

interface Props {
  params: Promise<{ fileId: string }>
}

/** NAS에 있는 실물 파일을 스트리밍한다. NAS는 인터넷에 인증서 없이 열려 있으므로
 *  브라우저가 직접 붙지 않고 반드시 이 라우트를 통과시킨다. */
export async function GET(_req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  }

  const { fileId } = await params
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, name: true, mimeType: true },
  })
  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 404 })

  const object = await getObject(objectKeyFor(file.id, file.name))

  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=3600",
    },
  })
}
