import { NextRequest, NextResponse } from "next/server"
import { r2SessionFrom } from "@/lib/r2/route"
import { abortR2Upload } from "@/lib/r2/upload"

/** 버리기 — 올린 조각을 지운다. 이미 첨부가 된 파일은 건드리지 않는다 */
export async function POST(req: NextRequest) {
  const gate = await r2SessionFrom(req)
  if (gate instanceof NextResponse) return gate
  await abortR2Upload(gate.upload)
  return new NextResponse(null, { status: 204 })
}
