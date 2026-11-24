// 채용 담당 — 지원서를 볼 수 있는 사람. AppSetting hr_reviewers = { userIds }.
//
// 관리자라고 자동으로 보이지 않는다. 관리자는 이 목록을 고칠 수 있으니 결국 볼 수 있지만, 그러려면 자기 이름을 넣어야 하고
// 그 일이 활동 기록에 남는다(설계 5-2). 목록이 비면 **아무도 못 본다** — 문의함은 「아무에게도 안 가는 것이 가장 나쁘다」 며
// ADMIN 으로 떨어뜨리지만, 지원서는 개인정보라 반대로 둔다. 대신 관리자에게 「담당이 없다」 만 알린다(lib/hr/intake.ts).
import { prisma } from "@/lib/db"
import { ACTIVE_MEMBER_WHERE } from "@/lib/active-members"
import { readSetting, writeSetting } from "@/lib/app-settings"
import { parseRecipients } from "@/lib/notify-recipients"

export const HR_REVIEWERS_KEY = "hr_reviewers"

export async function configuredReviewerIds(): Promise<string[]> {
  return parseRecipients(await readSetting(HR_REVIEWERS_KEY))
}

/** 지금 지원서를 볼 수 있는 재직 계정 id — 퇴사 · 비활성 계정은 목록에 남아 있어도 빠진다 */
export async function activeReviewerIds(): Promise<string[]> {
  const chosen = await configuredReviewerIds()
  if (chosen.length === 0) return []
  const rows = await prisma.user.findMany({ where: { id: { in: chosen }, ...ACTIVE_MEMBER_WHERE }, select: { id: true } })
  return rows.map((r) => r.id)
}

export async function isHrReviewer(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false
  return (await activeReviewerIds()).includes(userId)
}

export async function saveReviewerIds(userIds: string[], by: string): Promise<void> {
  await writeSetting(HR_REVIEWERS_KEY, { userIds: [...new Set(userIds)] }, by)
}
