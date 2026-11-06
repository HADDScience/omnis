/**
 * 관리자가 계정의 비밀번호를 무작위 값으로 바꾼다. 바뀐 계정은 처음 로그인할 때
 * 바꾸라는 안내를 본다(lib/password-state.ts 의 "reset" 기록). 막지는 않는다.
 *
 *   OUT=<새 비밀번호 파일> BACKUP=<기존 해시 백업> npx tsx scripts/reset-password.ts <이름>... [--apply]
 *
 * - `--apply` 가 없으면 바꿀 계정만 보여 주고 끝난다.
 * - 바꾸기 전에 기존 해시를 BACKUP 에 쓴다. 두 파일 모두 권한 600 이고, 이미 있으면 멈춘다.
 * - 새 비밀번호는 OUT 에만 쓴다. 화면에 내지 않는다.
 * - 로컬이 아닌 DB 는 `RESET_ALLOW_REMOTE=1` 이 있어야 돈다.
 * - 열려 있는 세션은 끊지 않는다 — 세션을 무효로 만드는 장치가 아직 없다. 이미 받은 세션은
 *   화면도 API 도 그대로 쓸 수 있다.
 */
import "dotenv/config"
import { existsSync, writeFileSync } from "node:fs"
import { randomInt } from "node:crypto"
import { hashSync } from "bcryptjs"
import { PrismaClient } from "../generated/prisma/client"

const prisma = new PrismaClient()
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

/** 4글자씩 4묶음. 헷갈리는 글자(0 O 1 l I)는 뺀다 */
function randomPassword(): string {
  return Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")).join("-")
}

async function main() {
  const apply = process.argv.includes("--apply")
  const names = process.argv.slice(2).filter((a) => a !== "--apply")
  if (names.length === 0) throw new Error("이름을 하나 이상 주세요")

  const host = new URL(process.env.DATABASE_URL ?? "").hostname
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && process.env.RESET_ALLOW_REMOTE !== "1") {
    throw new Error(`로컬이 아닌 DB(${host}) — 맞으면 RESET_ALLOW_REMOTE=1`)
  }

  const users = await prisma.user.findMany({ where: { name: { in: names } }, select: { id: true, name: true, isActive: true, passwordHash: true } })
  const missing = names.filter((n) => !users.some((u) => u.name === n))
  if (missing.length) throw new Error(`없는 계정: ${missing.join(", ")}`)
  const inactive = users.filter((u) => !u.isActive)
  if (inactive.length) throw new Error(`비활성 계정은 바꾸지 않는다: ${inactive.map((u) => u.name).join(", ")}`)

  console.log(`대상 ${users.length}개: ${users.map((u) => u.name).join(", ")}`)
  if (!apply) return console.log("--apply 가 없어 바꾸지 않았다")

  const out = process.env.OUT
  const backup = process.env.BACKUP
  if (!out || !backup) throw new Error("OUT 과 BACKUP 경로가 필요하다")
  if (existsSync(out) || existsSync(backup)) throw new Error("OUT 또는 BACKUP 파일이 이미 있다 — 덮어쓰지 않는다")

  const at = new Date().toISOString()
  writeFileSync(backup, JSON.stringify({ at, users: users.map(({ id, name, passwordHash }) => ({ id, name, passwordHash })) }, null, 1), { mode: 0o600 })

  const lines: string[] = []
  for (const u of users) {
    const password = randomPassword()
    await prisma.$transaction([
      prisma.user.update({ where: { id: u.id }, data: { passwordHash: hashSync(password, 10) } }),
      prisma.activityLog.create({ data: { userId: u.id, entity: "auth.password", entityId: u.id, action: "reset", title: "비밀번호 초기화" } }),
    ])
    lines.push(`${u.name}\t${password}`)
  }
  writeFileSync(out, `# ${at} 관리자 초기화. 로그인하면 바꾸라는 안내가 뜬다.\n${lines.join("\n")}\n`, { mode: 0o600 })
  console.log(`바꿈 ${lines.length}개. 새 비밀번호는 OUT 파일에만 있다`)
}

main().finally(() => prisma.$disconnect())
