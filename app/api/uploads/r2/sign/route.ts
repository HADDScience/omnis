import { NextRequest, NextResponse } from "next/server"
import { r2SessionFrom } from "@/lib/r2/route"
import { signR2Parts } from "@/lib/r2/upload"

/** 조각 PUT 서명 주소 — 바이트는 브라우저가 R2 로 바로 보낸다. 이 함수에는 번호 목록만 온다 */
export async function POST(req: NextRequest) {
  const gate = await r2SessionFrom(req)
  if (gate instanceof NextResponse) return gate
  const result = await signR2Parts(gate.upload, gate.body.parts)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ urls: result.urls }, { headers: { "Cache-Control": "no-store" } })
}
