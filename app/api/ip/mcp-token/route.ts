import { NextRequest } from "next/server"

import { currentMcpToken, reissueMcpToken } from "@/lib/ip-mcp"
import { authorize, isDenied, ok, preflight } from "@/lib/ip-api"

/**
 * MCP 개인 토큰. 「AI 도구 설치하기」 화면이 쓴다.
 *
 * 원문은 재발급 응답으로만 존재한다 — DB 에는 해시만 있어서, 화면을 벗어나면
 * 다시 볼 방법이 없다. 그때는 또 재발급받아야 한다.
 *
 * viewer 도 자기 토큰은 발급할 수 있다. 토큰은 신원만 알려주고 무엇을 할 수
 * 있는지는 역할이 정하므로, 발급을 막을 이유가 없다.
 */
export const dynamic = "force-dynamic"

export async function OPTIONS(req: NextRequest) {
  return preflight(req)
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response
  return ok({ token: await currentMcpToken(auth.caller.userId) }, auth.cors)
}

/** 재발급. 쓰던 것은 즉시 죽고 새 것 하나만 남는다. */
export async function POST(req: NextRequest) {
  const auth = await authorize(req, { write: false })
  if (isDenied(auth)) return auth.response
  return ok({ token: await reissueMcpToken(auth.caller.userId) }, auth.cors)
}
