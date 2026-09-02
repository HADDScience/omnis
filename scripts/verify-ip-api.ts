/**
 * 지식재산권 API 라우트 검증 — 권한 게이트가 실제로 막는지 본다.
 *
 *   TARGET_DB=… SSO_SIGNING_KEY=… IP_API_BASE=http://localhost:3050 \
 *     npx tsx scripts/verify-ip-api.ts
 *
 * 화면을 눌러 보는 것으로는 "구성원이 아닌 사람이 막히는가", "viewer 가 쓰기를
 * 못 하는가"를 재현하기 어렵다. 임시 계정을 만들어 역할을 바꿔 가며 실제 HTTP 로
 * 확인하고, 끝나면 지운다.
 */
import { issueSession, resolveApp } from "../lib/sso"
import { prisma } from "../lib/db"

const BASE = process.env.IP_API_BASE ?? "http://localhost:3050"
const ORIGIN = "http://localhost:3200" // ip-platform-dev 의 등록 오리진
const TEST_NAME = "__ip_api_test__"

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

async function call(
  path: string,
  init: RequestInit & { token?: string; origin?: string } = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    origin: init.origin ?? ORIGIN,
  }
  if (init.token) headers.authorization = `Bearer ${init.token}`
  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  const text = await res.text()
  let body: Record<string, unknown> = {}
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    body = { raw: text.slice(0, 120) }
  }
  return { status: res.status, body }
}

async function main() {
  const app = resolveApp("ip-platform-dev")
  if (!app) throw new Error("ip-platform-dev 가 등록돼 있지 않습니다 (NODE_ENV=production?)")

  // 임시 계정
  const user = await prisma.user.upsert({
    where: { name: TEST_NAME },
    update: { isActive: true },
    create: { name: TEST_NAME, email: "ip-api@local", passwordHash: "x", role: "MEMBER" },
    select: { id: true, name: true, email: true, role: true },
  })
  const { token } = await issueSession(app, user)

  console.log("\n[1] 토큰·오리진")
  check("토큰 없이 호출하면 401", (await call("/api/ip/snapshot")).status === 401)
  check(
    "쓰레기 토큰은 401",
    (await call("/api/ip/snapshot", { token: "garbage" })).status === 401
  )
  const wrongOrigin = await call("/api/ip/snapshot", {
    token,
    origin: "https://evil.example.com",
  })
  check("등록되지 않은 오리진은 403", wrongOrigin.status === 403)

  console.log("\n[2] 구성원이 아니면 막힌다")
  const outsider = await call("/api/ip/snapshot", { token })
  check(
    "Omnis 계정은 있어도 구성원이 아니면 403 not_a_member",
    outsider.status === 403 && outsider.body.error === "not_a_member",
    `${outsider.status} ${JSON.stringify(outsider.body)}`
  )

  console.log("\n[3] viewer 는 읽을 수 있고 쓸 수 없다")
  await prisma.$executeRaw`
    INSERT INTO ip.members (user_id, email, display_name, role)
    VALUES (${user.id}, ${`ip-api-test@local`}, ${TEST_NAME}, 'viewer')
    ON CONFLICT (user_id) DO UPDATE SET role = 'viewer'`

  const read = await call("/api/ip/snapshot", { token })
  check("viewer 가 조회하면 200", read.status === 200, `${read.status}`)
  const tm = (read.body.trademarks as unknown[]) ?? []
  check(`상표 ${tm.length}건이 실려 온다`, tm.length === 16, `${tm.length}건`)
  check("내 역할이 함께 온다", (read.body.me as { role?: string })?.role === "viewer")
  check(
    "날짜가 YYYY-MM-DD 문자열이다",
    tm.every((t) => {
      const d = (t as { date: string | null }).date
      return d === null || /^\d{4}-\d{2}-\d{2}$/.test(d)
    })
  )

  const viewerWrite = await call("/api/ip/flags", {
    method: "POST",
    token,
    body: JSON.stringify({ entityKind: "general", entityId: null, message: "테스트" }),
  })
  check(
    "viewer 가 쓰려 하면 403 read_only",
    viewerWrite.status === 403 && viewerWrite.body.error === "read_only",
    `${viewerWrite.status} ${JSON.stringify(viewerWrite.body)}`
  )

  console.log("\n[4] editor 는 쓸 수 있고, 트리거가 행위자를 남긴다")
  await prisma.$executeRaw`UPDATE ip.members SET role = 'editor' WHERE user_id = ${user.id}`

  const flagRes = await call("/api/ip/flags", {
    method: "POST",
    token,
    body: JSON.stringify({
      entityKind: "general",
      entityId: null,
      message: "__api 검증용 플래그__",
    }),
  })
  check("editor 가 쓰면 200", flagRes.status === 200, `${flagRes.status}`)

  // 진행 기록을 하나 넣어 트리거(감사·대장 반영)가 도는지 본다.
  const before = await prisma.$queryRaw<{ status: string; ref_date: Date | null }[]>`
    SELECT status, ref_date FROM ip.trademarks WHERE id = 'TM-04'`
  const progressRes = await call("/api/ip/progress", {
    method: "POST",
    token,
    body: JSON.stringify({
      isNew: true,
      entry: {
        date: "1999-01-01", // 아주 옛날 — 최신이 아니므로 단계를 덮어쓰면 안 된다
        entityKind: "trademark",
        entityId: "TM-04",
        stage: "검토의견",
        direction: null,
        counterpart: "",
        nextTurn: "none",
        dueOn: null,
        appNo: null,
        regNo: null,
        probability: null,
        name: null,
        holder: null,
        note: "__api 검증용 기록__",
        source: "manual",
        raw: null,
      },
    }),
  })
  check("진행 기록 저장 200", progressRes.status === 200, `${progressRes.status}`)

  const after = await prisma.$queryRaw<{ status: string; ref_date: Date | null }[]>`
    SELECT status, ref_date FROM ip.trademarks WHERE id = 'TM-04'`
  check(
    "옛 날짜 기록은 대장의 단계를 덮어쓰지 않는다 (apply_progress_entry 규칙)",
    before[0].status === after[0].status,
    `${before[0].status} → ${after[0].status}`
  )

  const audit = await prisma.$queryRaw<{ actor: string | null; op: string }[]>`
    SELECT actor, op FROM ip.audit_log
     WHERE entity = 'progress_entries' AND after->>'note' = '__api 검증용 기록__'
     ORDER BY at DESC LIMIT 1`
  check(
    "감사 기록이 남는다 (write_audit 트리거)",
    audit.length === 1 && audit[0].op === "insert",
    JSON.stringify(audit)
  )
  check(
    "감사 기록의 행위자가 요청자다 (ip.current_actor)",
    audit[0]?.actor === user.id,
    `actor=${audit[0]?.actor} expected=${user.id}`
  )

  console.log("\n[5] 개인 설정은 자기 것만")
  const prefsPost = await call("/api/ip/prefs", {
    method: "POST",
    token,
    body: JSON.stringify({ stageOrder: { trademark: ["검토중", "출원준비"] } }),
  })
  check("설정 저장 200", prefsPost.status === 200)
  const prefsGet = await call("/api/ip/prefs", { token })
  check(
    "저장한 설정이 그대로 돌아온다",
    JSON.stringify(
      (prefsGet.body.stageOrder as Record<string, string[]>)?.trademark
    ) === JSON.stringify(["검토중", "출원준비"]),
    JSON.stringify(prefsGet.body)
  )

  // ─── 정리 ───
  await prisma.$executeRaw`DELETE FROM ip.progress_entries WHERE note = '__api 검증용 기록__'`
  await prisma.$executeRaw`DELETE FROM ip.integrity_flags WHERE message = '__api 검증용 플래그__'`
  await prisma.$executeRaw`DELETE FROM ip.audit_log WHERE actor = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.member_prefs WHERE user_id = ${user.id}`
  await prisma.$executeRaw`DELETE FROM ip.members WHERE user_id = ${user.id}`
  await prisma.user.delete({ where: { id: user.id } })
  console.log("\n임시 계정·검증 데이터 정리 완료")

  console.log(`\n${failed === 0 ? "통과" : "실패"}: ${passed} passed, ${failed} failed\n`)
  await prisma.$disconnect()
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
