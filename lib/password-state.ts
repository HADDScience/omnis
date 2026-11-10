/**
 * 「관리자가 정해 준 비밀번호를 아직 쓰고 있다」 는 상태.
 *
 * 스키마에 칸을 더하지 않고 `ActivityLog` 의 마지막 기록으로 판단한다:
 * `entity = "auth.password"`, `entityId = userId` 의 가장 최근 `action` 이
 * `"reset"`(관리자가 바꿈 — scripts/reset-password.ts)이면 본인이 바꿀 때까지
 * 앱 화면에 바꾸라는 안내를 띄운다(막지 않는다 — 2026-11-06 핫픽스). 본인이 바꾸면 `"changed"` 가 남는다.
 */
import { prisma } from "./db"

export const PASSWORD_ENTITY = "auth.password"

export async function mustChangePassword(userId: string): Promise<boolean> {
  const last = await prisma.activityLog.findFirst({
    where: { entity: PASSWORD_ENTITY, entityId: userId },
    orderBy: { createdAt: "desc" },
    select: { action: true },
  })
  return last?.action === "reset"
}
