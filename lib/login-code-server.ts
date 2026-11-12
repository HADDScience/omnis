/**
 * 로그인 코드 보내기 · 확인 — 기록은 스키마를 늘리지 않고 ActivityLog 에 둔다(entity = auth.code).
 * - entityId = 사람 id: issued(title = 코드 HMAC) · wrong · used
 * - entityId = ip:<해시>: request (IP 제한)
 * 규칙은 lib/login-code.ts.
 */
import { prisma } from "./db"
import { sendMail } from "./mailer"
import { ipKey } from "./login-guard"
import { normalizeLoginName } from "./login-attempts"
import { CODE_ENTITY, CODE_LIMITS, activeCode, codeMail, codeMatches, generateCode, hashCode, isWorksMail } from "./login-code"

const secret = () => process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || ""

/** 이름 또는 웍스 메일로 사람을 찾는다 — trim · NFC, 메일은 대소문자 무시 */
export async function findLoginUser(identifier: string) {
  const id = normalizeLoginName(identifier)
  if (!id) return null
  if (id.includes("@")) {
    return prisma.user.findFirst({ where: { email: { equals: id, mode: "insensitive" }, isActive: true } })
  }
  return prisma.user.findFirst({ where: { name: id, isActive: true } })
}

/** IP 가 너무 많이 요청하면 false. 계정 쪽 제한 · 없는 계정은 조용히 넘긴다(응답은 언제나 같다) */
export async function requestLoginCode(identifier: string, ip: string | null, now = Date.now()): Promise<{ ipLimited: boolean }> {
  if (ip) {
    const n = await prisma.activityLog.count({
      where: { entity: CODE_ENTITY, entityId: ipKey(ip), action: "request", createdAt: { gt: new Date(now - CODE_LIMITS.ip.windowMs) } },
    })
    if (n >= CODE_LIMITS.ip.max) return { ipLimited: true }
    await prisma.activityLog.create({ data: { entity: CODE_ENTITY, entityId: ipKey(ip), action: "request", title: "로그인 코드 요청" } })
  }
  const user = await findLoginUser(identifier)
  if (!user || !isWorksMail(user.email) || !secret()) return { ipLimited: false }
  const recent = await prisma.activityLog.count({
    where: { entity: CODE_ENTITY, entityId: user.id, action: "issued", createdAt: { gt: new Date(now - CODE_LIMITS.account.windowMs) } },
  })
  if (recent >= CODE_LIMITS.account.max) return { ipLimited: false }

  const code = generateCode()
  await prisma.activityLog.create({
    data: { userId: user.id, entity: CODE_ENTITY, entityId: user.id, action: "issued", title: hashCode(user.id, code, secret()) },
  })
  const mail = codeMail(code)
  const result = await sendMail({ to: user.email.trim(), ...mail })
  if (!result.sent) console.error("[login-code] 메일을 보내지 못했다", result.transport, result.detail)
  return { ipLimited: false }
}

/** 코드가 맞으면 사람을, 아니면 null. 맞으면 그 코드는 쓴 것으로 남긴다 */
export async function verifyLoginCode(identifier: string, code: string, now = Date.now()) {
  const user = await findLoginUser(identifier)
  if (!user || !secret()) return null
  const logs = await prisma.activityLog.findMany({
    where: { entity: CODE_ENTITY, entityId: user.id, createdAt: { gt: new Date(now - CODE_LIMITS.account.windowMs - 60_000) } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { action: true, title: true, createdAt: true },
  })
  const active = activeCode(logs, now)
  if (!active) return null
  if (!codeMatches(user.id, code, active.hash, secret())) {
    await prisma.activityLog.create({ data: { userId: user.id, entity: CODE_ENTITY, entityId: user.id, action: "wrong", title: "로그인 코드 틀림" } })
    return null
  }
  await prisma.activityLog.create({ data: { userId: user.id, entity: CODE_ENTITY, entityId: user.id, action: "used", title: "로그인 코드 사용" } })
  return user
}
