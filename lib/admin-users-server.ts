/**
 * 관리자 페이지의 읽기 · 잠금 해제 — 규칙은 lib/admin-users.ts.
 *
 * DB 를 읽을 때도 `select` 로 칸을 좁힌다: User.passwordHash 와 auth.code issued 줄의 title(코드 HMAC)은 질의에 오르지도 않는다.
 */
import { prisma } from "./db"
import { accountKey, ADMIN_AUDIT_ENTITY, LOGIN_ENTITY, LOGIN_LIMITS } from "./login-guard"
import { CODE_ENTITY } from "./login-code"
import { passwordNotice } from "./password-notice"
import { PASSWORD_ENTITY } from "./password-state"
import { SYSTEM_USER_ID } from "./system-user"
import {
  accountLock,
  ADMIN_AUDIT_ACTIONS,
  ADMIN_UNLOCK_ACTION,
  CODE_HISTORY_DAYS,
  toAdminUserRow,
  type AdminUserRow,
} from "./admin-users"

const USER_SELECT = { id: true, name: true, email: true, role: true, isActive: true } as const

/** 그 사람으로 들어오는 로그인 키 — 비밀번호는 이름, 로그인 코드는 이름 또는 웍스 메일로 들어온다(lib/auth.ts) */
const loginKeys = (u: { name: string; email: string | null }) => [
  accountKey(u.name),
  ...(u.email?.trim() ? [accountKey(u.email.trim())] : []),
]

export async function loadAdminUsers(now = Date.now()): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({
    where: { id: { not: SYSTEM_USER_ID } },
    select: { ...USER_SELECT, identities: { select: { provider: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  })
  const ids = users.map((u) => u.id)
  const keys = users.flatMap(loginKeys)
  const [lastLogins, windowRows, pwLogs] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["userId"],
      where: { entity: LOGIN_ENTITY, action: "ok", userId: { in: ids } },
      _max: { createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { entity: LOGIN_ENTITY, entityId: { in: keys }, createdAt: { gt: new Date(now - LOGIN_LIMITS.account.windowMs) } },
      select: { entityId: true, action: true, createdAt: true },
    }),
    prisma.activityLog.findMany({
      where: { entity: PASSWORD_ENTITY, entityId: { in: ids }, action: { in: ["reset", "changed", "snoozed", "code_login"] } },
      select: { entityId: true, action: true, createdAt: true },
    }),
  ])
  const last = new Map(lastLogins.map((l) => [l.userId, l._max.createdAt]))
  return users.map((u) =>
    toAdminUserRow(u, {
      lastLoginAt: last.get(u.id) ?? null,
      social: u.identities.map((i) => i.provider),
      tempPassword: passwordNotice(pwLogs.filter((l) => l.entityId === u.id), new Date(now)).pending,
      lock: accountLock(windowRows, loginKeys(u), now, LOGIN_LIMITS.account),
    }),
  )
}

export interface CodeHistoryRow {
  id: string
  at: string
  userName: string
  action: string
}

/** 최근 30일 로그인 코드 기록 — 발송 · 로그인 · 틀림. 코드 값(title)은 select 하지 않는다 */
export async function loadLoginCodeHistory(now = Date.now()): Promise<CodeHistoryRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: {
      entity: CODE_ENTITY,
      action: { in: ["issued", "used", "wrong"] },
      userId: { not: null },
      createdAt: { gt: new Date(now - CODE_HISTORY_DAYS * 86_400_000) },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), userName: r.user?.name ?? "알 수 없음", action: r.action }))
}

/**
 * 잠금 해제 — 그 사람의 로그인 키마다 `unlock` 줄을 남겨 실패 수를 0 으로 되돌리고(lib/login-guard.ts),
 * 누가 누구를 풀었는지 감사 기록을 남긴다. 잠기지 않은 사람이면 아무것도 쓰지 않는다
 */
export async function unlockLogin(adminId: string, userId: string, now = Date.now()): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_locked" }> {
  const user = await prisma.user.findFirst({ where: { id: userId, NOT: { id: SYSTEM_USER_ID } }, select: { id: true, name: true, email: true } })
  if (!user) return { ok: false, reason: "not_found" }
  const keys = loginKeys(user)
  const rows = await prisma.activityLog.findMany({
    where: { entity: LOGIN_ENTITY, entityId: { in: keys }, createdAt: { gt: new Date(now - LOGIN_LIMITS.account.windowMs) } },
    select: { entityId: true, action: true, createdAt: true },
  })
  const lock = accountLock(rows, keys, now, LOGIN_LIMITS.account)
  if (!lock.locked) return { ok: false, reason: "not_locked" }
  await prisma.$transaction([
    prisma.activityLog.createMany({
      data: keys.map((entityId) => ({ entity: LOGIN_ENTITY, entityId, action: "unlock", title: "관리자 잠금 해제" })),
    }),
    prisma.activityLog.create({
      data: {
        userId: adminId,
        entity: ADMIN_AUDIT_ENTITY,
        entityId: user.id,
        action: ADMIN_UNLOCK_ACTION,
        title: `로그인 잠금 해제 — ${user.name}`,
        metadata: { until: new Date(lock.until).toISOString() },
      },
    }),
  ])
  return { ok: true }
}

export interface AuditRow {
  id: string
  at: string
  actor: string
  action: string
  title: string
}

/** 관리자 행동 감사 기록 — 누가 · 언제 · 무엇. 최근 것부터 */
export async function loadAdminAudit(take = 100): Promise<AuditRow[]> {
  const rows = await prisma.activityLog.findMany({
    where: { OR: [{ entity: ADMIN_AUDIT_ENTITY }, { action: { in: [...ADMIN_AUDIT_ACTIONS] } }] },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, action: true, title: true, createdAt: true, user: { select: { name: true } } },
  })
  return rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), actor: r.user?.name ?? "알 수 없음", action: r.action, title: r.title }))
}

/** 설문 현황 — 상태별 응답 수만. 내용 · 사람은 읽지 않는다 */
export async function loadSurveyCounts(): Promise<{ inProgress: number; confirm: number; submitted: number }> {
  const groups = await prisma.aiSurvey.groupBy({ by: ["status"], _count: { _all: true } })
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0
  return { inProgress: n("IN_PROGRESS"), confirm: n("CONFIRM"), submitted: n("SUBMITTED") }
}
