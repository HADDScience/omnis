import { NextRequest } from "next/server"
import { handlers } from "@/lib/auth"
import { BASE_PATH } from "@/lib/base-path"

/**
 * basePath(/omnis) 아래에서 Next 는 라우트 핸들러에 basePath 를 뗀 경로(/api/auth/…)를
 * 준다. NextAuth 는 자기 basePath(/omnis/api/auth)로 요청 경로에서 동작을 읽고 그 값으로
 * 콜백 주소도 만든다 — 하나로 두 일을 하므로, 뗀 경로를 도로 붙여서 넘긴다.
 * basePath 가 비어 있으면 아무것도 하지 않는다.
 */
function withBasePath(req: NextRequest): NextRequest {
  if (!BASE_PATH || req.nextUrl.pathname.startsWith(`${BASE_PATH}/`)) return req
  const url = new URL(req.url)
  url.pathname = `${BASE_PATH}${url.pathname}`
  return new NextRequest(url, req)
}

export const GET = (req: NextRequest) => handlers.GET(withBasePath(req))
export const POST = (req: NextRequest) => handlers.POST(withBasePath(req))
