// 지금 안내 판 읽기 · 올리기 — 판의 규칙은 lib/onboarding-version.ts. 서버에서만 쓴다(AppSetting)
import { prisma } from "@/lib/db"
import { readSetting } from "@/lib/app-settings"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { SYSTEM_USER_ID } from "@/lib/system-user"
import { ONBOARDING_VERSION_SETTING, effectiveOnboardingVersion } from "@/lib/onboarding-version"
import type { Prisma } from "@/generated/prisma/client"

/** 매 요청 DB 에서 읽는다 — 단추를 누른 바로 다음 화면부터 새 판이다(캐시 없음) */
export async function currentOnboardingVersion(): Promise<number> {
  return effectiveOnboardingVersion(await readSetting(ONBOARDING_VERSION_SETTING))
}

/** 판을 `next` 로 올리면 다시 보게 될 활성 사용자 수 — 본 판(비어 있으면 0 · 1)이 `next` 보다 낮은 사람 */
export async function countDueAt(next: number): Promise<number> {
  return prisma.user.count({
    where: { ...ACTIVE_MEMBER_WHERE, id: { not: SYSTEM_USER_ID }, OR: [{ onboardingVersion: null }, { onboardingVersion: { lt: next } }] },
  })
}

/**
 * 판을 하나 올린다. `from` 은 화면이 보고 있던 판 — 그새 누가 먼저 올렸으면(두 번 누름 · 두 관리자) 올리지 않고 null.
 * 저장된 값이 읽은 그대로일 때만 쓴다(조건부 갱신) — 동시에 둘이 와도 하나만 오른다
 */
export async function bumpOnboardingVersion(from: number, userId: string): Promise<{ from: number; to: number } | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: ONBOARDING_VERSION_SETTING }, select: { value: true } })
  const now = effectiveOnboardingVersion(row?.value ?? null)
  if (now !== from) return null
  const to = now + 1
  const value = { version: to } as Prisma.InputJsonValue
  if (row) {
    const done = await prisma.appSetting.updateMany({
      where: { key: ONBOARDING_VERSION_SETTING, value: { equals: row.value as Prisma.InputJsonValue } },
      data: { value, updatedById: userId },
    })
    if (done.count !== 1) return null
  } else {
    const made = await prisma.appSetting.createMany({ data: [{ key: ONBOARDING_VERSION_SETTING, value, updatedById: userId }], skipDuplicates: true })
    if (made.count !== 1) return null
  }
  return { from: now, to }
}
