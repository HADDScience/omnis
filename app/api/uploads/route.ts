import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { demoStorageBlocked } from "@/lib/demo"
import { largeUploadEnabled, openUploadSession } from "@/lib/large-upload/server"
import { r2UploadEnabled } from "@/lib/r2/server"
import { openR2Session } from "@/lib/r2/upload"

const bodySchema = z.object({
  name: z.string().min(1).max(1000),
  size: z.number().int().positive(),
  mimeType: z.string().max(200).default(""),
  scope: z.enum(["private"]).optional(),
})

/** 큰 첨부 세션 열기 — 4MB 초과만. 꺼져 있으면 없는 경로다. 응답의 backend 가 "r2" 면 화면이 R2 로 바로 올린다 */
export async function POST(req: NextRequest) {
  if (!largeUploadEnabled()) return NextResponse.json({ error: "없는 경로" }, { status: 404 })
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "인증 필요" }, { status: 401 })
  const blocked = demoStorageBlocked()
  if (blocked) return blocked

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "요청 형식이 맞지 않습니다" }, { status: 400 })
  const input = {
    userId: session.user.id,
    name: parsed.data.name,
    size: parsed.data.size,
    mimeType: parsed.data.mimeType,
    isPrivate: parsed.data.scope === "private",
  }
  // LARGE_UPLOAD_BACKEND=r2 이고 R2 값이 다 있을 때만 R2. 아니면 지금(#158) 경로 그대로
  const result = r2UploadEnabled() ? await openR2Session(input) : await openUploadSession({ ...input, origin: req.nextUrl.origin })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const { ok: _ok, ...body } = result
  return NextResponse.json(body, { status: 201 })
}
