/**
 * 웹 푸시 발송 검증 — 브라우저 없이 `lib/push.ts` 의 규칙을 실 DB 에 대고 돌린다.
 *
 * 브라우저를 거쳐야만 확인되는 것(권한 팝업 · 홈 화면 추가)은 여기서 못 본다.
 * 여기서 보는 것은 **서버가 무엇을 지우고 무엇을 남기는가**다. 그 판단이 틀리면
 * 멀쩡한 기기의 구독이 사라지거나, 죽은 구독이 영원히 쌓인다.
 *
 * 실제 푸시 서비스 대신 응답 코드를 마음대로 주는 로컬 서버를 세워 붙인다.
 * web-push 는 https 로만 보내므로(평문 http 는 TLS 오류로 끊긴다) 그 서버도 https 다 —
 * 자체 서명 인증서를 임시로 만들어 쓰고, 이 프로세스에서만 검증을 끈다.
 *
 *   set -a; source .env; set +a; pnpm exec tsx scripts/verify-push.ts
 */
import { execFileSync } from "node:child_process"
import { createECDH, randomBytes } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { createServer, type Server } from "node:https"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PrismaClient } from "../generated/prisma"

// 자체 서명 인증서를 쓰는 가짜 푸시 서비스에 붙기 위한 것. 검증 스크립트 안에서만 산다.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"

const prisma = new PrismaClient()

const TEST_USER_NAME = "__푸시검증__"

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/** 브라우저가 주는 것과 같은 모양의 구독 키. 암호화가 실제로 돌아야 하므로 진짜 P-256 키다. */
function fakeKeys() {
  const ecdh = createECDH("prime256v1")
  ecdh.generateKeys()
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  }
}

/** 임시 자체 서명 인증서. 프로세스가 끝나면 지운다. */
function selfSignedCert() {
  const dir = mkdtempSync(join(tmpdir(), "omnis-push-verify-"))
  const key = join(dir, "key.pem")
  const cert = join(dir, "cert.pem")
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", key, "-out", cert, "-days", "1",
    "-subj", "/CN=127.0.0.1",
  ], { stdio: "ignore" })
  return {
    key: readFileSync(key),
    cert: readFileSync(cert),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  }
}

const tls = selfSignedCert()

/** 요청마다 정해진 상태 코드를 돌려주는 가짜 푸시 서비스. */
function fakePushService(status: number): Promise<{ server: Server; origin: string; hits: () => number }> {
  let hits = 0
  const server = createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
    hits += 1
    req.resume()
    res.writeHead(status)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      resolve({ server, origin: `https://127.0.0.1:${port}`, hits: () => hits })
    })
  })
}

async function main() {
  // VAPID 키가 없으면 발송 자체를 건너뛰므로, 없으면 검증이 성립하지 않는다.
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    console.error("VAPID 키가 없다. .env 를 확인한다.")
    process.exit(1)
  }
  process.env.VAPID_SUBJECT ??= "mailto:test@haddscience.com"

  // import 시점에 env 를 읽으므로 확인 뒤에 불러온다.
  const { sendPushToUser, pushConfigured } = await import("../lib/push")

  check("설정이 갖춰졌다고 본다", pushConfigured())

  const user = await prisma.user.upsert({
    where: { name: TEST_USER_NAME },
    create: { name: TEST_USER_NAME, passwordHash: "x", isActive: false },
    update: {},
  })

  try {
    // ── 구독이 없으면 보내지 않는다 ──────────────────────────
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } })
    const empty = await sendPushToUser(user.id, { title: "없음" })
    check("구독이 없으면 0건", empty.sent === 0 && empty.removed === 0, JSON.stringify(empty))

    // ── 살아 있는 구독: 보내고, 남긴다 ───────────────────────
    const alive = await fakePushService(201)
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: `${alive.origin}/alive`, ...fakeKeys() },
    })
    const sentResult = await sendPushToUser(user.id, { title: "보냄", body: "본문", url: "/tasks/1" })
    check("살아 있는 구독으로 1건 나간다", sentResult.sent === 1, JSON.stringify(sentResult))
    check("푸시 서비스가 실제로 요청을 받았다", alive.hits() === 1, `hits=${alive.hits()}`)
    check(
      "살아 있는 구독은 남는다",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 1
    )
    alive.server.close()

    // ── 410: 죽은 구독은 지운다 ─────────────────────────────
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } })
    const gone = await fakePushService(410)
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: `${gone.origin}/gone`, ...fakeKeys() },
    })
    const goneResult = await sendPushToUser(user.id, { title: "죽음" })
    check("410 은 발송 0건", goneResult.sent === 0, JSON.stringify(goneResult))
    check("410 이면 구독을 지운다", goneResult.removed === 1, JSON.stringify(goneResult))
    check(
      "지운 뒤 행이 남지 않는다",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 0
    )
    gone.server.close()

    // ── 거부되어야 하는 경우 ────────────────────────────────
    // 500 은 푸시 서비스가 잠깐 아픈 것이다. 이걸 죽은 구독으로 보고 지우면
    // 멀쩡한 기기가 조용히 알림을 못 받게 된다 — 사람은 이유를 알 길이 없다.
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } })
    const flaky = await fakePushService(500)
    await prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: `${flaky.origin}/flaky`, ...fakeKeys() },
    })
    const flakyResult = await sendPushToUser(user.id, { title: "일시 오류" })
    check("500 은 발송 0건", flakyResult.sent === 0, JSON.stringify(flakyResult))
    check("500 에는 구독을 지우지 않는다", flakyResult.removed === 0, JSON.stringify(flakyResult))
    check(
      "일시 오류 뒤에도 구독이 남는다",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 1
    )
    flaky.server.close()

    // ── 사람이 지워지면 구독도 함께 사라진다 (onDelete: Cascade) ──
    await prisma.user.delete({ where: { id: user.id } })
    check(
      "사용자를 지우면 구독도 사라진다",
      (await prisma.pushSubscription.count({ where: { userId: user.id } })) === 0
    )
  } finally {
    await prisma.pushSubscription.deleteMany({ where: { userId: user.id } })
    await prisma.user.deleteMany({ where: { name: TEST_USER_NAME } })
    await prisma.$disconnect()
    tls.cleanup()
  }

  console.log(`\n${passed}건 통과 · ${failed}건 실패`)
  process.exit(failed === 0 ? 0 : 1)
}

void main()
