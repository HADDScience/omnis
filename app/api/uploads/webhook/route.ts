import { NextRequest, NextResponse } from "next/server"
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"
import { finalizeUpload, largeUploadEnabled } from "@/lib/large-upload/server"
import { verifyUploadSession } from "@/lib/large-upload/session"

/**
 * 임시 저장소가 올리기 완료를 알린다 — 화면의 완료 요청이 유실돼도 첨부가 만들어지게.
 * 서명은 handleUpload 가 본다. 토큰은 여기서 만들지 않는다(/api/uploads).
 */
export async function POST(req: NextRequest) {
  if (!largeUploadEnabled()) return NextResponse.json({ error: "없는 경로" }, { status: 404 })
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null
  if (body?.type !== "blob.upload-completed") return NextResponse.json({ error: "요청 형식이 맞지 않습니다" }, { status: 400 })
  try {
    const out = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        throw new Error("이 경로는 토큰을 만들지 않습니다")
      },
      onUploadCompleted: async ({ tokenPayload }) => {
        const session = verifyUploadSession(tokenPayload)
        if (!session) throw new Error("세션이 맞지 않습니다")
        const result = await finalizeUpload(session)
        if (!result.ok) throw new Error(result.error)
      },
    })
    return NextResponse.json(out)
  } catch (e) {
    console.error("[large-upload] 웹훅 처리 실패", e)
    return NextResponse.json({ error: "처리하지 못했습니다" }, { status: 400 })
  }
}
