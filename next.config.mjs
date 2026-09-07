import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  devIndicators: false, // 좌측하단 Next.js 개발 툴박스 숨김
  typescript: {
    ignoreBuildErrors: false,
  },
  turbopack: {
    root: __dirname,
  },
  /*
   * OAuth 디스커버리를 호스트 루트에도 놓는다.
   *
   * 이 서버의 issuer 는 경로가 붙은 주소(.../api/ip-mcp)라, 규격대로라면
   * 메타데이터는 호스트와 경로 사이에 `.well-known` 을 끼운 자리에 있어야 한다
   * (RFC 8414 §3.1 · RFC 9728). 우리는 경로 뒤에 붙인 자리에만 두고 있어서,
   * 규격을 그대로 따르는 클라이언트가 404 를 받았다. claude.ai 웹 커넥터가
   * 그래서 붙지 않았다 — Supabase 함수 아래 있을 때는 호스트 루트를 쓸 수 없어
   * 손댈 수 없었지만, Vercel 로 옮겼으니 이제 열 수 있다.
   *
   * 경로 없는 루트 자리에도 같은 문서를 둔다. 그쪽만 찾아보는 클라이언트가
   * 있고, 404 를 주는 것보다는 나은 답이기 때문이다. 서버는 resource 값을
   * 검사하지 않으므로 어느 쪽으로 찾아오든 발급 결과는 같다.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-authorization-server/api/ip-mcp",
        destination: "/api/ip-mcp/.well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource/api/ip-mcp",
        destination: "/api/ip-mcp/.well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/ip-mcp/.well-known/oauth-authorization-server",
      },
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/ip-mcp/.well-known/oauth-protected-resource",
      },
    ]
  },
}

export default nextConfig
