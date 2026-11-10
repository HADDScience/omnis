import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { findVisibleFile } from "@/lib/file-access-server"
import { fileResponseHeaders, NOSNIFF } from "@/lib/file-serving"
import { publicUrl } from "@/lib/base-path"
import { runAfterResponse } from "@/lib/after-response"
import { acceptsWebp, thumbPlan, thumbWidth } from "@/lib/thumb"
import { loadThumb } from "@/lib/thumb-server"

interface Props {
  params: Promise<{ fileId: string }>
}

/**
 * 사진 미리보기(WebP). 폭은 lib/thumb.ts 의 단계로 올린다. 처음 요청 때 만들어 NAS 의 _thumbs/ 에 두고 이후엔 그것을 준다.
 * 권한은 /raw 와 같은 findVisibleFile. WebP 를 받지 않는 브라우저 · GIF · 너무 큰 사진 · 만들지 못한 사진은 원본(/raw)으로 보낸다.
 */
export async function GET(req: NextRequest, { params }: Props) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const { fileId } = await params
  const file = await findVisibleFile(fileId, session.user.id)
  if (!file) return NextResponse.json({ error: "파일 없음" }, { status: 404, headers: NOSNIFF })

  const plan = thumbPlan(file)
  if (plan === "none") return NextResponse.json({ error: "미리보기가 없는 형식입니다" }, { status: 415, headers: NOSNIFF })
  const original = () =>
    NextResponse.redirect(publicUrl(`/api/files/${file.id}/raw`, req.url), { status: 302, headers: { Vary: "Accept", ...NOSNIFF } })
  if (plan === "original" || !acceptsWebp(req.headers.get("accept"))) return original()

  const width = thumbWidth(Number(req.nextUrl.searchParams.get("w")) || 480)
  let result
  try {
    result = await loadThumb(file, width, (task) => runAfterResponse("thumb-cache", task))
  } catch (err) {
    console.error("[thumb]", file.id, err)
    return original()
  }
  const base = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name
  return new NextResponse(new Uint8Array(result.body), {
    headers: {
      ...fileResponseHeaders({ mimeType: "image/webp", name: `${base}.webp` }),
      "Content-Length": String(result.body.length),
      Vary: "Accept",
      "X-Thumb-Cache": result.cache,
      // 원본과 같은 규칙 — 참여자만 보는 방의 사진은 브라우저에 남기지 않는다
      "Cache-Control": file.isPrivate ? "private, no-store" : "private, max-age=86400",
    },
  })
}
