import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { withWorkflow } from "workflow/next"

import { brandRewrites, resolveBrand } from "./lib/brand-static.mjs"
import { collectLicenses, collectUpdates } from "./lib/app-info-build.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 앱 정보의 버전 표시(마이 > 앱 정보, lib/app-version.ts) — package 버전과 빌드 시각을 번들에 싣는다
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))

/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined

const nextConfig = {
  output: "standalone",
  /*
   * 한 도메인의 하위 경로(/omnis)로 뜰 때. env 로 켜고 끈다 — 코드는 한 번만 바꾸고,
   * 되돌리기는 env 를 비우고 재배포하는 것뿐이다. lib/base-path.ts 참조.
   */
  basePath,
  assetPrefix: basePath,
  /*
   * next-auth/react 는 클라이언트에서 NEXTAUTH_URL 의 경로를 자기 basePath 로 삼는다.
   * NEXT_PUBLIC_ 이 아니라 번들에 안 실리므로 여기서 실어 준다 (비밀이 아니다 — 주소다).
   */
  env: {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    // 화면이 그려진 빌드의 커밋 — 열어 둔 탭은 옛 빌드일 수 있어 서버 값이 아니라 이것을 기록한다(lib/ui-metrics)
    NEXT_PUBLIC_BUILD_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
    NEXT_PUBLIC_APP_VERSION: pkg.version ?? "",
    // 빌드한 시각(배포 날짜로 보인다). Vercel 은 배포마다 새로 빌드한다
    NEXT_PUBLIC_BUILD_AT: new Date().toISOString(),
    // 앱 정보의 업데이트 소식(머지된 PR 제목 최근 10건) · 오픈소스 라이선스 — 빌드 때 만든다(lib/app-info-build.mjs).
    // NEXT_PUBLIC_ 이 아니다 — 서버 화면만 읽는다
    APP_UPDATES_JSON: JSON.stringify(collectUpdates(__dirname)),
    APP_LICENSES_JSON: JSON.stringify(collectLicenses(__dirname)),
    // 큰 첨부 — 화면이 같은 값을 본다. 서버는 LARGE_UPLOAD_ENABLED 를 직접 본다(lib/large-upload/server.ts). 켜고 끄려면 재배포한다
    // R2 스위치(LARGE_UPLOAD_BACKEND=r2 + R2 값 넷)만 있어도 켠다 — 판정은 lib/r2/server.ts r2UploadEnabled 와 같다
    NEXT_PUBLIC_LARGE_UPLOAD:
      process.env.LARGE_UPLOAD_ENABLED === "1" ||
      (process.env.LARGE_UPLOAD_BACKEND === "r2" &&
        process.env.R2_BUCKET &&
        process.env.R2_ACCESS_KEY_ID &&
        process.env.R2_SECRET_ACCESS_KEY &&
        (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT))
        ? "1"
        : "",
    // 사용 기록은 운영에서만. 데모 · 프리뷰 · 로컬은 끈다. e2e 는 이 값을 직접 준다
    NEXT_PUBLIC_UI_METRICS:
      process.env.NEXT_PUBLIC_UI_METRICS ??
      (process.env.VERCEL_ENV === "production" && process.env.NEXT_PUBLIC_IS_DEMO !== "true" ? "1" : ""),
  },
  devIndicators: false, // 좌측하단 Next.js 개발 툴박스 숨김
  /*
   * 클라이언트 라우터 캐시 — 한 번 연 화면을 이 시간 동안 브라우저에 두어, 탭을 오갈 때
   * 서버가 DB 를 다시 읽는 동안 화면이 멈추지 않게 한다(블로킹 내비게이션). 기본값 dynamic 0 은
   * 매번 서버로 갔다. 30초 안에 돌아오면 그때의 화면을 그대로 보인다 — 쓰기 뒤에는
   * router.refresh() 가 이 캐시를 버린다. 채팅 · 방 목록은 기기 저장(lib/chat-cache.ts)이 따로 맡는다.
   */
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
  },
  /*
   * Workflow 경로(withWorkflow 가 만드는 /.well-known/workflow/*)의 함수에 Prisma 엔진을 싣는다.
   * 이 경로는 단계 코드를 따로 묶어 Next 의 파일 추적이 generated/prisma 의 엔진을 따라가지 못했다 —
   * 운영(2026-10-29)에서 옴니스 방 첫 단계가 「Query Engine for runtime "rhel-openssl-3.0.x"」 를 못 찾아
   * 실행이 RUNNING 에 멈췄다. 로컬 dev · next start 는 디스크에서 엔진을 찾아 드러나지 않았다.
   */
  outputFileTracingIncludes: {
    "/.well-known/workflow/**": ["./generated/prisma/**/*.node", "./generated/prisma/schema.prisma"],
  },
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
  /*
   * basePath 가 켜지면 루트 경로(/tasks, /sso/authorize, /api/…)는 Next 가 아예 받지 않는다.
   * 옛 북마크·아직 옛 주소를 부르는 앱을 /omnis 아래로 넘긴다. 이 호스트로 직접 온
   * 요청만 해당한다 — haddscience 가 rewrite 로 보내는 요청은 이미 /omnis 로 시작한다.
   * (POST 는 307 이라 메서드가 유지되지만 CORS preflight 는 redirect 를 안 따라가므로,
   * 브라우저에서 fetch 하는 앱은 새 주소로 빌드해야 한다.)
   */
  async redirects() {
    if (!basePath) return []
    return [
      {
        source: "/:path((?!omnis(?:/|$)|_next/|_vercel/).*)",
        destination: `${basePath}/:path`,
        basePath: false,
        permanent: false,
      },
    ]
  },
  async rewrites() {
    /*
     * basePath 를 뗀 뒤에도 옛 주소(/omnis/…)를 그대로 받는다 (2026-09-18, 도메인 이전).
     *
     * redirect 가 아니라 rewrite 다. 옛 주소로 등록된 것이 사람의 북마크만이 아니기 때문이다 —
     * claude.ai MCP 커넥터가 `…/omnis/api/ip-mcp` 로 등록돼 있고, OAuth 디스커버리는
     * `/.well-known/…/omnis/api/ip-mcp` 를 찾는다. 이런 클라이언트는 redirect 를 따라가지
     * 않거나 따라가도 POST 본문을 잃는다. rewrite 면 주소가 그대로인 채 안에서 이어진다.
     * 홈페이지(haddscience.com/omnis)가 넘겨주는 요청도 여기로 들어온다.
     *
     * 배열로 준 rewrite 는 동적 라우트보다 먼저 걸린다. 그래서 `/omnis/:path*` 가
     * 지식 카드 상세(`/omnis/[cardId]`)와 분류(`/omnis/c/[categorySlug]`)를 가로채
     * `/<카드 id>` 로 보내 404 가 났다(2026-10-27). 그 두 경로를 제자리로 먼저 보낸다 —
     * rewrite 뒤에 라우트가 잡히면 거기서 멈추므로 아래 옛 주소 규칙까지 가지 않는다.
     */
    const legacy = basePath
      ? []
      : [
          { source: "/omnis", destination: "/" },
          {
            source: "/omnis/:cardId([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
            destination: "/omnis/:cardId",
          },
          { source: "/omnis/c/:categorySlug", destination: "/omnis/c/:categorySlug" },
          { source: "/omnis/:path*", destination: "/:path*" },
          {
            source: "/.well-known/oauth-authorization-server/omnis/api/ip-mcp",
            destination: "/api/ip-mcp/.well-known/oauth-authorization-server",
          },
          {
            source: "/.well-known/oauth-protected-resource/omnis/api/ip-mcp",
            destination: "/api/ip-mcp/.well-known/oauth-protected-resource",
          },
        ]
    const afterFiles = [
      ...legacy,
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
    /*
     * 새 로고(NEXT_PUBLIC_BRAND=v2) — 주소가 고정된 정적 로고를 public/brand/v2/ 로 돌린다(lib/brand-static.mjs).
     * public 파일보다 먼저 걸려야 해서 beforeFiles 다. v1 이면 빈 목록이라 지금과 같다.
     */
    return { beforeFiles: brandRewrites(resolveBrand(process.env.NEXT_PUBLIC_BRAND)), afterFiles, fallback: [] }
  },
}

/*
 * Workflow — "use workflow" · "use step" 지시어를 컴파일하고 /.well-known/workflow/* 경로를 붙인다(옴니스 에이전트, lib/agent/).
 * 로컬은 Local World(.workflow-data/), Vercel 배포는 Vercel World 가 자동으로 붙는다.
 */
export default withWorkflow(nextConfig)
