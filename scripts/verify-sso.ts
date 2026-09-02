/**
 * lib/sso.ts 검증 — 실제 서명 키와 실제 DB 에 대고 돌린다.
 *
 *   set -a; source <(grep -E '^(DATABASE_URL)=' .env.vercel); set +a
 *   SSO_SIGNING_KEY="$(cat /path/to/sso-key.json)" npx tsx scripts/verify-sso.ts
 *
 * 브라우저 왕복 없이 규칙 자체를 확인하는 것이 목적이다. 화면을 눌러 보는 것으로는
 * "만료된 토큰이 거부되는가", "표를 두 번 쓰면 막히는가" 를 재현하기 어렵다.
 */
import { SignJWT, importJWK, type JWK } from "jose"

import {
  consumeGrant,
  issueGrant,
  issueSession,
  resolveApp,
  safeReturnPath,
  verifyGrant,
  verifySession,
} from "../lib/sso"
import { prisma } from "../lib/db"

/**
 * 이미 만료된 토큰을 같은 키로 직접 만든다.
 *
 * Date.now 를 가짜로 밀어도 jose 는 내부에서 new Date() 를 보므로 통하지 않는다.
 * 60초·8시간을 실제로 기다릴 수도 없으니, 발급기와 같은 서명 키로 exp 가 과거인
 * 토큰을 만들어 검증기가 정말로 시각을 보는지 확인한다.
 */
async function forgeExpired(kind: "grant" | "session", audience: string): Promise<string> {
  const jwk = JSON.parse(process.env.SSO_SIGNING_KEY!) as JWK
  const key = await importJWK(jwk, "ES256")
  const past = Math.floor(Date.now() / 1000) - 3600
  return new SignJWT({ kind, sub: "test-user-id", jti: crypto.randomUUID(), name: "x", role: "MEMBER" })
    .setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
    .setIssuer(process.env.SSO_ISSUER ?? process.env.NEXTAUTH_URL ?? "https://omnis-hadd.vercel.app")
    .setAudience(audience)
    .setIssuedAt(past - 60)
    .setExpirationTime(past)
    .sign(key)
}

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

async function main() {
  const hub = resolveApp("hub")
  const ip = resolveApp("ip-platform")
  if (!hub || !ip) throw new Error("앱 레지스트리를 읽지 못했습니다.")

  // ─── 1. 앱 화이트리스트 ─────────────────────────────────────────
  console.log("\n[1] 앱 화이트리스트")
  check("등록된 앱은 통과", resolveApp("hub") !== null)
  check("등록되지 않은 앱은 거부", resolveApp("evil") === null)
  check("빈 값은 거부", resolveApp("") === null && resolveApp(null) === null)

  // ─── 2. 복귀 경로(오픈 리다이렉트) ───────────────────────────────
  console.log("\n[2] 복귀 경로 검증")
  const allow: [string | null, string][] = [
    [null, "/hub/"],
    ["/hub/", "/hub/"],
    ["/hub/account/", "/hub/account/"],
    ["/hub", "/hub"],
    ["/hub/?tab=apps", "/hub/?tab=apps"],
  ]
  for (const [input, want] of allow) {
    const got = safeReturnPath(hub, input)
    check(`허용: ${JSON.stringify(input)} → ${want}`, got === want, `got ${JSON.stringify(got)}`)
  }

  const deny: [string, string][] = [
    ["//evil.com", "프로토콜 상대 주소"],
    ["/\\evil.com", "역슬래시 변종"],
    ["https://evil.com", "절대 URL"],
    ["http://evil.com/hub/", "절대 URL(http)"],
    ["evil.com", "스킴 없는 호스트"],
    ["/hub/..%2f..", "인코딩된 상위 경로"],
    ["/hub/../ip-platform/", "상위 경로로 앱 이탈"],
    ["/ip-platform/", "다른 앱 경로"],
    ["/raman-g-peak-diff/", "같은 오리진의 남의 경로"],
    ["/hubris/", "basePath 접두사만 같은 경로"],
    ["/hub/#sso=x", "프래그먼트 주입"],
    ["/hub/\nLocation: https://evil.com", "헤더 분리 시도"],
    ["/hub/ evil", "공백"],
  ]
  for (const [input, why] of deny) {
    check(`거부: ${JSON.stringify(input)} (${why})`, safeReturnPath(hub, input) === null)
  }
  check("basePath 가 다른 앱은 자기 경로만", safeReturnPath(ip, "/ip-platform/x") === "/ip-platform/x")
  check("basePath 가 다른 앱에 hub 경로는 거부", safeReturnPath(ip, "/hub/") === null)

  // ─── 3. grant: 서명·audience·만료 ────────────────────────────────
  console.log("\n[3] grant 토큰")
  const grant = await issueGrant(hub, "test-user-id")
  const okClaims = await verifyGrant(grant, hub)
  check("정상 grant 는 통과", okClaims !== null && okClaims.userId === "test-user-id")
  check("hub 용 grant 를 ip-platform 이 쓰면 거부", (await verifyGrant(grant, ip)) === null)
  check("변조된 서명은 거부", (await verifyGrant(grant.slice(0, -3) + "AAA", hub)) === null)
  check("쓰레기 문자열은 거부", (await verifyGrant("not-a-token", hub)) === null)

  check("만료된 grant 는 거부", (await verifyGrant(await forgeExpired("grant", "hub"), hub)) === null)

  // ─── 4. 1회용 강제 ──────────────────────────────────────────────
  console.log("\n[4] grant 1회용")
  const single = await issueGrant(hub, "test-user-id")
  const singleClaims = await verifyGrant(single, hub)
  if (!singleClaims) throw new Error("grant 검증 실패")
  check("첫 사용은 통과", await consumeGrant(singleClaims))
  check("같은 표를 두 번 쓰면 거부", (await consumeGrant(singleClaims)) === false)
  check("세 번째도 거부", (await consumeGrant(singleClaims)) === false)
  await prisma.ssoGrant.deleteMany({ where: { userId: "test-user-id" } })

  // ─── 5. 세션 토큰 ───────────────────────────────────────────────
  console.log("\n[5] 세션 토큰")
  const subject = { id: "u-1", name: "정우창", email: "jwoochang@haddscience.com", role: "ADMIN" }
  const { token: sess } = await issueSession(hub, subject)
  const sessClaims = await verifySession(sess, hub)
  check("정상 세션은 통과", sessClaims?.userId === "u-1" && sessClaims?.name === "정우창")
  check("hub 세션을 ip-platform 이 쓰면 거부", (await verifySession(sess, ip)) === null)
  check("세션 토큰을 grant 로 쓰면 거부", (await verifyGrant(sess, hub)) === null)
  check("grant 를 세션으로 쓰면 거부", (await verifySession(single, hub)) === null)

  check(
    "만료된 세션은 거부",
    (await verifySession(await forgeExpired("session", "hub"), hub)) === null
  )

  console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
