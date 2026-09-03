// Omnis 를 사내 도구의 로그인 발급자(IdP)로 만드는 최소 SSO.
//
// 왜 필요한가: 허브(GitHub Pages)와 Omnis(Vercel)는 오리진이 다르다. 예전 허브는
// Supabase 세션을 localStorage 로 "같은 오리진끼리" 나눠 쓰는 방식이라 오리진이
// 다른 Omnis 로는 넓힐 수 없었다. 그래서 Omnis 가 짧은 수명의 서명 토큰을 발급하고,
// 정적 앱들이 그걸 받아 자기 세션을 얻는 구조로 바꾼다.
//
// 흐름:
//   1. 앱 → GET /sso/authorize?app=hub&next=/hub/
//   2. Omnis 로그인 확인 (미로그인이면 /login 으로 보냈다가 되돌아온다)
//   3. 302 → https://haddscience.github.io/hub/#sso=<grant>   (60초·1회용)
//   4. 앱 → POST /api/sso/redeem  { token, app }   →  세션 토큰(8시간) + 프로필
//   5. 앱 → POST /api/sso/verify  { token, app }   →  새로고침마다 유효성 재확인
//
// 토큰을 프래그먼트(#)로 넘기는 이유: 프래그먼트는 서버로 전송되지 않아
// GitHub Pages 접근 로그에도, Referer 헤더에도 남지 않는다.
//
// 이 파일은 DB 를 쓰는 consumeGrant 를 빼면 전부 순수 함수다. 실제 브라우저
// 왕복 없이 검증할 수 있게 일부러 그렇게 갈랐다 (lib/auth-identity.ts 와 같은 방침).

import { SignJWT, jwtVerify, importJWK, type JWK, type JWTPayload } from "jose"
import { prisma } from "./db"

// ─── 앱 화이트리스트 ────────────────────────────────────────────────
//
// `next` 파라미터를 그대로 믿지 않는 것이 핵심이다. 돌아갈 오리진은 언제나
// 이 표에서 오고, `next` 는 그 앱의 basePath 안쪽 경로인지만 검사해 덧붙인다.
// 등록되지 않은 app 은 400 이라, 주소를 조작해도 토큰이 밖으로 나가지 않는다.

export interface SsoApp {
  /** authorize 요청의 `app` 값이자 토큰의 audience */
  id: string
  /** 오류 화면에 보여줄 이름 */
  label: string
  /** 돌아갈 오리진. 여기서만 온다 — 요청이 정하지 못한다. */
  origin: string
  /** 그 오리진 안에서 이 앱이 차지하는 경로. `next` 는 이 아래여야 한다. */
  basePath: string
}

const PRODUCTION_APPS: SsoApp[] = [
  {
    id: "hub",
    label: "HADD Hub",
    origin: "https://haddscience.github.io",
    basePath: "/hub",
  },
  {
    id: "ip-platform",
    label: "지식재산권 팔로우업",
    origin: "https://haddscience.github.io",
    basePath: "/ip-platform",
  },
  {
    id: "ai-alzheimer",
    label: "AI Alzheimer (라만 분광 분석)",
    origin: "https://haddscience.github.io",
    basePath: "/raman-g-peak-diff",
  },
  {
    // 사내망(Tailscale) 안에서만 열린다. 밖에서는 이름이 풀리지 않으므로
    // 등록해 두어도 밖에서 이 오리진으로 토큰이 나갈 일이 없다.
    id: "ai-ecm",
    label: "AI ECM (장기별 ECM 조성 처방)",
    origin: "https://macbookpro.tail28eea6.ts.net",
    basePath: "",
  },
]

/**
 * 로컬 개발용 항목. 배포 환경에서는 등록되지 않는다.
 * 허브를 `next dev` 로 띄우면 http://localhost:3100/hub 에 뜬다.
 */
const DEVELOPMENT_APPS: SsoApp[] = [
  { id: "hub-dev", label: "HADD Hub (로컬)", origin: "http://localhost:3100", basePath: "/hub" },
  { id: "ip-platform-dev", label: "지식재산권 팔로우업 (로컬)", origin: "http://localhost:3200", basePath: "" },
]

export const SSO_APPS: SsoApp[] =
  process.env.NODE_ENV === "production"
    ? PRODUCTION_APPS
    : [...PRODUCTION_APPS, ...DEVELOPMENT_APPS]

/** 등록된 앱만 돌려준다. 모르는 id 는 null — 호출부는 400 으로 끝내야 한다. */
export function resolveApp(id: string | null | undefined): SsoApp | null {
  if (!id) return null
  return SSO_APPS.find((app) => app.id === id) ?? null
}

/** 이 오리진으로 오는 브라우저 요청에 CORS 를 열어도 되는가. */
export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  return SSO_APPS.some((app) => app.origin === origin)
}

// ─── 복귀 경로 검증 ─────────────────────────────────────────────────

/**
 * `next` 를 앱의 basePath 안쪽 절대 경로로만 허용한다 (오픈 리다이렉트 방지).
 * 통과하지 못하면 null — 호출부는 조용히 기본값으로 갈아치우지 말고 거부해야 한다.
 *
 * 막는 것들:
 *  - `//evil.com`, `/\evil.com` — 브라우저가 다른 오리진으로 읽는 형태
 *  - `\` 가 섞인 경로 — 위 두 형태의 변종
 *  - `..` 세그먼트 — 같은 오리진의 다른 앱 경로로 새는 것
 *  - `#` — 우리가 토큰을 실을 프래그먼트와 충돌한다
 *  - 제어문자·공백 — Location 헤더 분리 시도
 */
export function safeReturnPath(app: SsoApp, next: string | null | undefined): string | null {
  const fallback = `${app.basePath}/`
  if (next === null || next === undefined || next === "") return fallback

  if (!next.startsWith("/")) return null
  if (next.startsWith("//") || next.startsWith("/\\")) return null
  if (next.includes("\\") || next.includes("#")) return null
  if (/[\u0000-\u0020\u007f]/.test(next)) return null

  // `%2e%2e%2f` 처럼 인코딩해 오는 경우가 있어 디코딩한 모습으로도 한 번 본다.
  // 브라우저가 %2f 를 경로 구분자로 되돌리지는 않지만, 이 경로를 그대로 받아
  // 라우팅하는 앱이 나중에 생길 수 있으므로 여기서 잘라 둔다.
  let decoded = next
  try {
    decoded = decodeURIComponent(next)
  } catch {
    return null // 깨진 퍼센트 인코딩
  }
  if (decoded.includes("\\") || decoded.includes("#")) return null

  for (const candidate of [next, decoded]) {
    const segments = candidate.split("?")[0].split("/")
    if (segments.includes("..") || segments.includes(".")) return null
  }

  // basePath 밖으로는 못 나간다. `/hub` 용 토큰이 `/ip-platform/` 로 배달되면
  // 같은 오리진이라 해도 audience 를 나눈 의미가 사라진다.
  if (app.basePath !== "") {
    if (next !== app.basePath && !next.startsWith(`${app.basePath}/`)) return null
  }

  return next
}

/** 토큰을 프래그먼트에 실어 앱으로 돌려보낼 절대 주소. */
export function buildReturnUrl(app: SsoApp, path: string, token: string): string {
  return `${app.origin}${path}#sso=${encodeURIComponent(token)}`
}

// ─── 서명 키 ────────────────────────────────────────────────────────
//
// 비대칭(ES256)을 쓰는 이유: 정적 앱은 비밀키를 들 수 없다. 공개키를 /api/sso/jwks
// 로 공개해 두면 우리 검증 엔드포인트 말고 다른 곳(예: 외부 DB 의 JWT 검증)도
// 같은 토큰을 스스로 검증할 수 있다. HS256 이면 그 길이 막힌다.

const ISSUER = process.env.SSO_ISSUER ?? process.env.NEXTAUTH_URL ?? "https://omnis-hadd.vercel.app"

/** grant 는 배달 중에만 살아 있으면 된다. 짧을수록 좋다. */
const GRANT_TTL_SECONDS = 60
/** 앱이 들고 다니는 세션. 만료 전에도 verify 로 즉시 무효화할 수 있다. */
const SESSION_TTL_SECONDS = 8 * 60 * 60

let cachedPrivate: { jwk: JWK; key: CryptoKey } | null = null
let cachedPublic: CryptoKey | null = null

function readSigningJwk(): JWK | null {
  const raw = process.env.SSO_SIGNING_KEY
  if (!raw) return null
  try {
    const jwk = JSON.parse(raw) as JWK
    if (jwk.kty !== "EC" || !jwk.d || !jwk.kid) return null
    return jwk
  } catch {
    return null
  }
}

/** SSO 를 쓸 수 있는 배포인가. 키가 없으면 엔드포인트가 503 으로 끝난다. */
export function ssoEnabled(): boolean {
  return readSigningJwk() !== null
}

async function signingKey() {
  if (cachedPrivate) return cachedPrivate
  const jwk = readSigningJwk()
  if (!jwk) throw new Error("SSO_SIGNING_KEY 가 설정되지 않았습니다.")
  const key = (await importJWK(jwk, "ES256")) as CryptoKey
  cachedPrivate = { jwk, key }
  return cachedPrivate
}

/**
 * 검증용 공개키.
 *
 * 개인키로는 검증할 수 없다 — WebCrypto 는 ECDSA 개인키에 sign 용도만 부여하므로
 * 같은 키 객체로 verify 를 부르면 InvalidAccessError 로 튕긴다. 그래서 d 를 떼고
 * 공개키를 따로 import 한다.
 */
async function verificationKey(): Promise<CryptoKey> {
  if (cachedPublic) return cachedPublic
  const jwk = readSigningJwk()
  if (!jwk) throw new Error("SSO_SIGNING_KEY 가 설정되지 않았습니다.")
  const { d: _private, ...pub } = jwk
  cachedPublic = (await importJWK(pub, "ES256")) as CryptoKey
  return cachedPublic
}

/** 공개키 묶음. 개인키 성분(d)은 빼고 내보낸다. */
export async function publicJwks(): Promise<{ keys: JWK[] }> {
  const jwk = readSigningJwk()
  if (!jwk) return { keys: [] }
  const { d: _private, ...pub } = jwk
  return { keys: [{ ...pub, alg: "ES256", use: "sig" }] }
}

// ─── 토큰 발급·검증 ─────────────────────────────────────────────────

export interface GrantClaims {
  jti: string
  appId: string
  userId: string
  expiresAt: Date
}

export interface SessionClaims {
  appId: string
  userId: string
  name: string
  email: string | null
  role: string
  expiresAt: Date
}

async function sign(payload: JWTPayload, audience: string, ttl: number): Promise<string> {
  const { jwk, key } = await signingKey()
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key)
}

async function verify(token: string, audience: string): Promise<JWTPayload> {
  const key = await verificationKey()
  const { payload } = await jwtVerify(token, key, {
    issuer: ISSUER,
    audience,
    algorithms: ["ES256"],
    // 시계 오차 허용치. 60초짜리 토큰에 넉넉한 여유를 주면 수명 제한이 무의미해진다.
    clockTolerance: 5,
  })
  return payload
}

/** 로그인이 확인된 사용자에게 이 앱으로 한 번 들어갈 수 있는 표를 끊는다. */
export async function issueGrant(app: SsoApp, userId: string): Promise<string> {
  return sign({ kind: "grant", sub: userId, jti: crypto.randomUUID() }, app.id, GRANT_TTL_SECONDS)
}

/**
 * grant 검증 — 서명·발급자·수신자(aud)·만료를 본다.
 * 아직 "1회용"은 확인하지 않는다. 그건 consumeGrant 가 DB 로 한다.
 */
export async function verifyGrant(token: string, app: SsoApp): Promise<GrantClaims | null> {
  try {
    const payload = await verify(token, app.id)
    if (payload.kind !== "grant") return null
    if (!payload.sub || !payload.jti || !payload.exp) return null
    return {
      jti: payload.jti,
      appId: app.id,
      userId: payload.sub,
      expiresAt: new Date(payload.exp * 1000),
    }
  } catch {
    return null
  }
}

/**
 * grant 를 소모한다. 처음이면 true, 이미 쓴 표면 false.
 *
 * jti 를 유니크 키로 INSERT 하는 것이 곧 검사다. 메모리 캐시로는
 * 서버리스 인스턴스가 여러 개일 때 같은 표가 두 번 통과할 수 있다.
 */
export async function consumeGrant(claims: GrantClaims): Promise<boolean> {
  try {
    await prisma.ssoGrant.create({
      data: {
        jti: claims.jti,
        appId: claims.appId,
        userId: claims.userId,
        expiresAt: claims.expiresAt,
      },
    })
  } catch (err) {
    // P2002 = 유니크 위반 = 같은 jti 가 이미 있다 = 재사용 시도
    if ((err as { code?: string }).code === "P2002") return false
    throw err
  }

  // 만료된 표는 더 이상 재사용 판정에 쓸모가 없다. 매번 쓸면 지연이 늘어나므로
  // 가끔만 치운다 — 남아 있어도 안전 쪽으로만 틀린다(중복 거부).
  if (Math.random() < 0.05) {
    await prisma.ssoGrant
      .deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60_000) } } })
      .catch(() => {})
  }
  return true
}

export interface SessionSubject {
  id: string
  name: string
  email: string | null
  role: string
}

/** 앱이 들고 다닐 세션 토큰. aud 가 앱 id 라 다른 앱에서는 통하지 않는다. */
export async function issueSession(app: SsoApp, user: SessionSubject): Promise<{
  token: string
  expiresAt: number
}> {
  const token = await sign(
    { kind: "session", sub: user.id, name: user.name, email: user.email, role: user.role },
    app.id,
    SESSION_TTL_SECONDS
  )
  return { token, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 }
}

export async function verifySession(token: string, app: SsoApp): Promise<SessionClaims | null> {
  try {
    const payload = await verify(token, app.id)
    if (payload.kind !== "session") return null
    if (!payload.sub || !payload.exp) return null
    return {
      appId: app.id,
      userId: payload.sub,
      name: String(payload.name ?? ""),
      email: (payload.email as string | null) ?? null,
      role: String(payload.role ?? "MEMBER"),
      expiresAt: new Date(payload.exp * 1000),
    }
  } catch {
    return null
  }
}

// ─── CORS ───────────────────────────────────────────────────────────
//
// 정적 앱이 브라우저에서 직접 부르는 엔드포인트다. 등록된 오리진에만 연다.

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!isAllowedOrigin(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin as string,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  }
}
