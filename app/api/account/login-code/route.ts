import { NextRequest, NextResponse } from "next/server"
import { apiError, parseJson } from "@/lib/api"
import { clientIp } from "@/lib/login-guard"
import { CODE_SENT_MESSAGE } from "@/lib/login-code"
import { requestLoginCode } from "@/lib/login-code-server"

/**
 * 로그인 코드 받기 — 로그인 없이 부른다. 응답은 계정이 있든 없든 같다(CODE_SENT_MESSAGE).
 * IP 가 너무 많이 부를 때만 429 다(계정과 상관없는 제한이라 계정 유무가 드러나지 않는다). 규칙: lib/login-code.ts
 */
export async function POST(req: NextRequest) {
  const body = await parseJson<{ identifier?: unknown }>(req)
  const identifier = typeof body?.identifier === "string" ? body.identifier.slice(0, 200) : ""
  if (!identifier.trim()) return apiError(400, "이름 또는 웍스 메일을 입력하세요.")
  const { ipLimited } = await requestLoginCode(identifier, clientIp(req.headers))
  if (ipLimited) return apiError(429, "요청이 너무 많습니다. 15분 뒤 다시 시도하세요.")
  return NextResponse.json({ ok: true, message: CODE_SENT_MESSAGE })
}
