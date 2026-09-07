import { Readable } from "node:stream"

import { NextRequest, NextResponse } from "next/server"

import { prisma } from "@/lib/db"
import { getObject } from "@/lib/storage"
import { parseMediaPath } from "@/lib/website-media"

/**
 * 사진 — 공개. NAS 에서 스트리밍한다.
 *
 * 이름이 업로드마다 고유하므로 영구 캐시한다. Vercel 엣지가 1년 들고 있어 NAS 가 잠깐
 * 꺼져도 한 번 나간 사진은 계속 나간다. 목록(WebsiteMedia)에 없는 키는 NAS 에 있어도
 * 내보내지 않는다 — 이 경로로 NAS 를 뒤지지 못하게.
 */
export const dynamic = "force-dynamic"

type Props = { params: Promise<{ postId: string; name: string }> }

export async function GET(_req: NextRequest, { params }: Props) {
  const { postId, name } = await params
  const parsed = parseMediaPath(postId, name)
  if (!parsed) return new NextResponse(null, { status: 404 })

  const media = await prisma.websiteMedia.findUnique({
    where: { key: parsed.key },
    select: { contentType: true, size: true },
  })
  if (!media) return new NextResponse(null, { status: 404 })

  const object = await getObject(parsed.key)
  return new NextResponse(Readable.toWeb(object.body) as ReadableStream, {
    headers: {
      "Content-Type": media.contentType,
      "Content-Length": String(media.size),
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  })
}
