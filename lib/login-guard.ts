/**
 * 비밀번호 로그인 시도 제한 — 계정 기준과 IP 기준을 따로 센다.
 *
 * ## 어디에 남기나
 *
 * 새 표를 만들지 않고 `ActivityLog` 를 쓴다(스키마 변경 없음). 한 번의 실패가 두 줄이 된다:
 * `entity = "auth.login"`, `entityId = "acct:<해시>"` 와 `"ip:<해시>"`. 표의
 * `[entity, entityId, createdAt]` 색인이 두 질의를 그대로 받는다.
 *
 * **입력한 이름과 IP 를 원문으로 남기지 않는다.** 사람들은 이름 칸에 비밀번호를 치기도
 * 한다. 해시는 같은 값끼리 묶는 데만 쓴다.
 *
 * ## 규칙
 *
 * - 계정: 마지막 성공 뒤의 실패가 창(15분) 안에 5번이면 잠근다. 성공하면 다시 센다.
 * - IP: 창 안의 실패가 30번이면 잠근다. 여러 이름을 돌려 가며 찍는 경우를 막는다.
 * - 잠긴 동안에는 비밀번호를 대조하지 않는다. 시간이 지나면 저절로 풀린다.
 *
 * 계정 잠금은 남이 일부러 틀려서 그 사람을 15분 묶을 수 있다는 뜻이기도 하다. 창을 짧게
 * 둔 이유다.
 */
import { createHash } from "node:crypto"
import { prisma } from "./db"

export const LOGIN_LIMITS = {
  account: { max: 5, windowMs: 15 * 60 * 1000 },
  ip: { max: 30, windowMs: 15 * 60 * 1000 },
} as const

export const LOGIN_ENTITY = "auth.login"
/** 활동 기록 화면·API 에 내보내지 않는 entity. 인증 흔적은 남이 볼 것이 아니다 */
export const PRIVATE_ACTIVITY_ENTITIES = [LOGIN_ENTITY, "auth.password"]

const digest = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 32)
export const accountKey = (name: string) => `acct:${digest(name.trim().toLowerCase())}`
export const ipKey = (ip: string) => `ip:${digest(ip)}`

/**
 * 요청을 보낸 곳. Vercel 은 `x-forwarded-for` 를 자기가 본 주소로 덮어쓴다.
 * 로컬에서는 누구나 붙일 수 있는 헤더라 시험이 이것으로 IP 를 나눈다.
 */
export function clientIp(headers: Headers | undefined | null): string | null {
  if (!headers) return null
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  return forwarded || headers.get("x-real-ip")?.trim() || null
}

export type LockState = { locked: false } | { locked: true; reason: "account" | "ip" }

export async function loginLockState(name: string, ip: string | null, now = Date.now()): Promise<LockState> {
  const acct = accountKey(name)
  const lastOk = await prisma.activityLog.findFirst({
    where: { entity: LOGIN_ENTITY, entityId: acct, action: "ok" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  const windowStart = now - LOGIN_LIMITS.account.windowMs
  const since = new Date(Math.max(windowStart, lastOk?.createdAt.getTime() ?? 0))
  const accountFails = await prisma.activityLog.count({
    where: { entity: LOGIN_ENTITY, entityId: acct, action: "fail", createdAt: { gt: since } },
  })
  if (accountFails >= LOGIN_LIMITS.account.max) return { locked: true, reason: "account" }

  if (ip) {
    const ipFails = await prisma.activityLog.count({
      where: {
        entity: LOGIN_ENTITY,
        entityId: ipKey(ip),
        action: "fail",
        createdAt: { gt: new Date(now - LOGIN_LIMITS.ip.windowMs) },
      },
    })
    if (ipFails >= LOGIN_LIMITS.ip.max) return { locked: true, reason: "ip" }
  }
  return { locked: false }
}

export async function recordLoginFailure(name: string, ip: string | null) {
  const rows = [accountKey(name), ...(ip ? [ipKey(ip)] : [])].map((entityId) => ({
    entity: LOGIN_ENTITY,
    entityId,
    action: "fail",
    title: "로그인 실패",
  }))
  await prisma.activityLog.createMany({ data: rows })
}

export async function recordLoginSuccess(userId: string, name: string) {
  await prisma.activityLog.create({
    data: { userId, entity: LOGIN_ENTITY, entityId: accountKey(name), action: "ok", title: "로그인" },
  })
}
