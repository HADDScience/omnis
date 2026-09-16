/**
 * e2e 전용 계정을 만든다(이미 있으면 비밀번호만 맞춘다).
 *
 * ## 왜 있는가
 *
 * feature e2e 는 `팀장` · `부팀장` · `사원1~3` 으로 로그인한다. 데모 DB 에는 그
 * 이름들이 있지만 **운영 스냅샷을 복원한 로컬 테스트 서버에는 없다** — 거기에는
 * 실제 사람 이름이 들어 있다. 그래서 지금까지 로컬에서 e2e 나 화면 점검을 하려면
 * 실제 사람의 비밀번호를 임시로 바꿔 쓰고 되돌려야 했다(2026-09-09 에 실제로
 * 그랬다). 실수로 되돌리지 않으면 그 사람이 못 들어온다.
 *
 * 이 스크립트는 **더하기만 한다.** 아무것도 지우거나 비우지 않는다 —
 * `prisma/demo-seed.ts` 와 다르다(그쪽은 모든 테이블을 TRUNCATE 한다).
 *
 * ## 쓰는 법
 *
 *   E2E_PASSWORD=... npx tsx scripts/ensure-e2e-accounts.ts
 *
 * | 환경변수 | 기본값 | 뜻 |
 * |---|---|---|
 * | `E2E_PASSWORD` | `demo1234` | 만들 계정의 비밀번호 |
 * | `E2E_ACCOUNTS_ALLOW_REMOTE` | (없음) | 로컬이 아닌 DB 에 돌릴 때 `1` |
 */
import "dotenv/config"
import { PrismaClient } from "../generated/prisma/client"
import { hashSync } from "bcryptjs"

const prisma = new PrismaClient()

/** tests/feature/_setup.ts 의 ADMINS · MEMBERS 와 같은 목록이어야 한다. */
const ACCOUNTS = [
  { name: "팀장", role: "ADMIN" as const },
  { name: "부팀장", role: "ADMIN" as const },
  { name: "사원1", role: "MEMBER" as const },
  { name: "사원2", role: "MEMBER" as const },
  { name: "사원3", role: "MEMBER" as const },
]

const PASSWORD = process.env.E2E_PASSWORD ?? "demo1234"

/**
 * 운영 DB 에 테스트 계정을 만들면 그 계정으로 아무나 들어올 수 있다.
 * 로컬이 아니면 명시적으로 허용해야 돈다.
 */
function assertNotProduction() {
  const raw = process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL 이 없다")
  const host = new URL(raw).hostname
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
  if (!local && process.env.E2E_ACCOUNTS_ALLOW_REMOTE !== "1") {
    throw new Error(
      `로컬이 아닌 DB(${host}) — 테스트 계정을 만들 곳이 맞으면 E2E_ACCOUNTS_ALLOW_REMOTE=1 을 붙여 다시 실행`,
    )
  }
  return { host, local }
}

async function main() {
  const { host } = assertNotProduction()
  if (PASSWORD.length < 6) throw new Error("E2E_PASSWORD 가 6자 미만이다")

  const hash = hashSync(PASSWORD, 10)
  const before = await prisma.user.count()

  for (const a of ACCOUNTS) {
    // 이름이 unique 다. 있으면 비밀번호·권한만 맞추고 나머지 칸은 건드리지 않는다.
    await prisma.user.upsert({
      where: { name: a.name },
      update: { passwordHash: hash, role: a.role, isActive: true },
      create: { name: a.name, role: a.role, passwordHash: hash, isActive: true },
    })
  }

  const after = await prisma.user.count()
  console.log(`DB ${host} — 계정 ${ACCOUNTS.length}개 준비 완료 (사용자 ${before} → ${after})`)
  console.log(ACCOUNTS.map((a) => `  ${a.name} (${a.role})`).join("\n"))
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
