/**
 * 배포본(/api/sso/redeem)이 계정 상태를 실제로 보는지 확인한다.
 *
 * 로컬에서 배포본과 같은 키로 grant 를 끊어 프로덕션에 밀어 넣는다.
 * 브라우저로는 재현하기 어려운 두 경우 — 퇴사자(isActive=false)와 없는 계정 — 를 본다.
 *
 *   set -a; source <(grep -E '^(DATABASE_URL)=' .env.vercel); set +a
 *   SSO_SIGNING_KEY="$(cat …/sso-key.json)" npx tsx scripts/verify-sso-live.ts
 */
import { issueGrant, resolveApp } from "../lib/sso"
import { prisma } from "../lib/db"

const BASE = process.env.SSO_BASE ?? "https://omnis-hadd.vercel.app"
const ORIGIN = "https://haddscience.github.io"

async function redeem(token: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}/api/sso/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN },
    body: JSON.stringify({ token, app: "hub" }),
  })
  return { status: res.status, body: await res.text() }
}

async function main() {
  const hub = resolveApp("hub")!
  const marker = `__sso-test-${Date.now()}`

  // 1) 존재하지 않는 계정
  const ghost = await redeem(await issueGrant(hub, "00000000-0000-0000-0000-000000000000"))
  console.log(`없는 계정        → ${ghost.status} ${ghost.body}`)

  // 2) 비활성 계정 (퇴사 처리)
  const inactive = await prisma.user.create({
    data: { name: marker, passwordHash: "x", isActive: false, role: "MEMBER" },
    select: { id: true },
  })
  const fired = await redeem(await issueGrant(hub, inactive.id))
  console.log(`퇴사자(비활성)   → ${fired.status} ${fired.body}`)

  // 3) 같은 계정을 되살리면 통과해야 한다 (거부가 isActive 때문임을 보인다)
  await prisma.user.update({ where: { id: inactive.id }, data: { isActive: true } })
  const revived = await redeem(await issueGrant(hub, inactive.id))
  console.log(`활성으로 되돌림  → ${revived.status} ${revived.body.slice(0, 90)}…`)

  await prisma.ssoGrant.deleteMany({ where: { userId: inactive.id } })
  await prisma.user.delete({ where: { id: inactive.id } })
  console.log("\n테스트 계정 삭제 완료")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
