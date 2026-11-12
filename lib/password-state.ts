/**
 * 「관리자가 정해 준 비밀번호를 아직 쓰고 있다」 는 상태.
 *
 * 스키마에 칸을 더하지 않고 `ActivityLog` 의 기록으로 판단한다:
 * `entity = "auth.password"`, `entityId = userId` 의 가장 최근 reset · changed 가 `"reset"`(관리자가 바꿈 —
 * scripts/reset-password.ts)이면 본인이 바꿀 때까지 앱 화면에 바꾸라는 안내를 띄운다(막지 않는다 — 2026-11-06 핫픽스).
 * 본인이 바꾸면 `"changed"` 가 남는다. 안내의 「나중에」 는 `"snoozed"` 로 남아 7일 동안 안내를 숨긴다
 * (2026-11-11 — 판정 규칙은 lib/password-notice.ts).
 */
import { prisma } from "./db"
import { passwordNotice, type PasswordNotice } from "./password-notice"

export const PASSWORD_ENTITY = "auth.password"

export async function passwordNoticeFor(userId: string, now = new Date()): Promise<PasswordNotice> {
  // 사람 한 명의 비밀번호 기록은 몇 줄뿐이다 — 최근 것부터 넉넉히 읽는다
  const logs = await prisma.activityLog.findMany({
    where: { entity: PASSWORD_ENTITY, entityId: userId, action: { in: ["reset", "changed", "snoozed", "code_login"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { action: true, createdAt: true },
  })
  return passwordNotice(logs, now)
}

export async function mustChangePassword(userId: string): Promise<boolean> {
  return (await passwordNoticeFor(userId)).pending
}
