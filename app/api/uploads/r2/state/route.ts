import { NextRequest, NextResponse } from "next/server"
import { r2SessionFrom } from "@/lib/r2/route"
import { r2UploadState } from "@/lib/r2/upload"

/** 이어 올리기 — 저장소(ListParts)에 남은 조각과 아직 보낼 조각 */
export async function POST(req: NextRequest) {
  const gate = await r2SessionFrom(req)
  if (gate instanceof NextResponse) return gate
  const result = await r2UploadState(gate.upload)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ done: result.done, missing: result.missing }, { headers: { "Cache-Control": "no-store" } })
}
